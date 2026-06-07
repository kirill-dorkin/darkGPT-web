import { randomInt } from "crypto";
import { Pool, PoolClient, QueryResultRow } from "pg";
import {
  FREE_REQUESTS_PER_DAY,
  PACKAGES,
  REFERRAL_BONUS,
  REFERRAL_PAYMENT_BONUS,
  REQUEST_COST,
  isLanguage,
  type Language,
  type PackageKey,
} from "@/lib/constants";

export type UserRecord = {
  user_id: string;
  username: string | null;
  language: Language | null;
  created_at: Date;
  referred_by: string | null;
  free_requests_used_today: number;
  free_requests_reset_date: Date;
  credit_balance: number;
  total_credits_purchased: number;
  total_credits_spent: number;
  referral_count: number;
  paid_referral_count: number;
  last_activity_at: Date;
  language_selected: boolean;
  referral_awarded: boolean;
  referral_payment_awarded: boolean;
};

export type PaymentRecord = {
  id: number;
  user_id: string;
  amount_usd: number;
  credits_amount: number;
  provider: string;
  provider_invoice_id: string | null;
  provider_invoice_url: string | null;
  status: string;
  created_at: Date;
  paid_at: Date | null;
};

export type RequestAccess =
  | { canUse: true; type: "free" | "credits"; remaining: number; cost: number }
  | { canUse: false; type: "user_not_found" | "limit_reached" | "not_enough_credits"; remaining: number | null; cost: number };

export type ChargeResult =
  | { success: true; type: "free" | "credits"; remaining: number; cost: number; balance: number }
  | { success: false; type: "limit_reached" | "not_enough_credits"; remaining: number; cost: number; balance: number };

let pool: Pool | null = null;
let schemaPromise: Promise<void> | null = null;

function normalizeDatabaseUrl(databaseUrl: string) {
  if (databaseUrl.startsWith("postgresql+psycopg://")) {
    return `postgresql://${databaseUrl.slice("postgresql+psycopg://".length)}`;
  }
  return databaseUrl;
}

function getDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return normalizeDatabaseUrl(databaseUrl);
}

function getPool() {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    const needsSsl =
      connectionString.includes("sslmode=require") ||
      process.env.PGSSLMODE === "require" ||
      connectionString.includes("neon.tech");

    pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    });
  }

  return pool;
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = getPool();
      await db.query(`
        CREATE TABLE IF NOT EXISTS users (
          user_id BIGINT PRIMARY KEY,
          username VARCHAR(255),
          language VARCHAR(8),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          referred_by BIGINT,
          free_requests_used_today INTEGER NOT NULL DEFAULT 0,
          free_requests_reset_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          credit_balance INTEGER NOT NULL DEFAULT 0,
          total_credits_purchased INTEGER NOT NULL DEFAULT 0,
          total_credits_spent INTEGER NOT NULL DEFAULT 0,
          referral_count INTEGER NOT NULL DEFAULT 0,
          paid_referral_count INTEGER NOT NULL DEFAULT 0,
          last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          language_selected BOOLEAN NOT NULL DEFAULT FALSE,
          referral_awarded BOOLEAN NOT NULL DEFAULT FALSE,
          referral_payment_awarded BOOLEAN NOT NULL DEFAULT FALSE
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS payments (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          amount_usd DOUBLE PRECISION NOT NULL,
          credits_amount INTEGER NOT NULL,
          provider VARCHAR(64) NOT NULL DEFAULT 'crypto_pay',
          provider_invoice_id VARCHAR(255) UNIQUE,
          provider_invoice_url TEXT,
          status VARCHAR(32) NOT NULL DEFAULT 'pending',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          paid_at TIMESTAMPTZ
        )
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS credit_transactions (
          id SERIAL PRIMARY KEY,
          user_id BIGINT NOT NULL REFERENCES users(user_id),
          amount INTEGER NOT NULL,
          type VARCHAR(64) NOT NULL,
          description TEXT,
          payment_id INTEGER REFERENCES payments(id),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    })();
  }

  return schemaPromise;
}

async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  await ensureSchema();
  return getPool().query<T>(text, values);
}

async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function rowToUser(row: UserRecord | undefined): UserRecord | null {
  if (!row) {
    return null;
  }
  return {
    ...row,
    user_id: String(row.user_id),
    referred_by: row.referred_by ? String(row.referred_by) : null,
    language: isLanguage(row.language) ? row.language : null,
    free_requests_used_today: Number(row.free_requests_used_today),
    credit_balance: Number(row.credit_balance),
    total_credits_purchased: Number(row.total_credits_purchased),
    total_credits_spent: Number(row.total_credits_spent),
    referral_count: Number(row.referral_count),
    paid_referral_count: Number(row.paid_referral_count),
    language_selected: Boolean(row.language_selected),
    referral_awarded: Boolean(row.referral_awarded),
    referral_payment_awarded: Boolean(row.referral_payment_awarded),
  };
}

function rowToPayment(row: PaymentRecord | undefined): PaymentRecord | null {
  if (!row) {
    return null;
  }
  return {
    ...row,
    id: Number(row.id),
    user_id: String(row.user_id),
    amount_usd: Number(row.amount_usd),
    credits_amount: Number(row.credits_amount),
  };
}

function isSameLocalDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

async function getUserInClient(client: PoolClient, userId: string) {
  const result = await client.query<UserRecord>("SELECT * FROM users WHERE user_id = $1", [userId]);
  return rowToUser(result.rows[0]);
}

async function resetDailyRequestsInClient(client: PoolClient, userId: string, now = new Date()) {
  const result = await client.query<Pick<UserRecord, "free_requests_reset_date">>(
    "SELECT free_requests_reset_date FROM users WHERE user_id = $1",
    [userId],
  );
  const resetAt = result.rows[0]?.free_requests_reset_date;
  if (!resetAt || isSameLocalDay(new Date(resetAt), now)) {
    return false;
  }

  await client.query(
    `
      UPDATE users
      SET free_requests_used_today = 0,
          free_requests_reset_date = $2,
          last_activity_at = $2
      WHERE user_id = $1
    `,
    [userId, now],
  );
  return true;
}

export function parseUserId(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{4,18}$/.test(text)) {
    return null;
  }
  return text;
}

export function parseReferralArg(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return null;
  }
  const text = String(value).trim().replace(/^ref_/, "");
  return parseUserId(text);
}

export async function generateUserId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const userId = String(randomInt(1_000_000_000_000, 8_999_999_999_999));
    if (!(await getUser(userId))) {
      return userId;
    }
  }
  return String(Date.now()) + String(randomInt(1000, 9999));
}

export async function getUser(userId: string) {
  const result = await query<UserRecord>("SELECT * FROM users WHERE user_id = $1", [userId]);
  return rowToUser(result.rows[0]);
}

export async function ensureUser(userId: string, username: string | null = "web", referredBy?: string | null) {
  const validReferrer = referredBy && referredBy !== userId ? referredBy : null;
  return withTransaction(async (client) => {
    const existing = await getUserInClient(client, userId);
    if (!existing) {
      await client.query(
        `
          INSERT INTO users (user_id, username, referred_by, created_at, last_activity_at, free_requests_reset_date)
          VALUES ($1, $2, $3, NOW(), NOW(), NOW())
        `,
        [userId, username, validReferrer],
      );
      return getUserInClient(client, userId);
    }

    await client.query(
      `
        UPDATE users
        SET username = COALESCE($2, username),
            referred_by = CASE
              WHEN $3::BIGINT IS NOT NULL
                AND referred_by IS NULL
                AND referral_awarded = FALSE
                AND user_id <> $3::BIGINT
              THEN $3::BIGINT
              ELSE referred_by
            END,
            last_activity_at = NOW()
        WHERE user_id = $1
      `,
      [userId, username, validReferrer],
    );
    return getUserInClient(client, userId);
  });
}

export async function updateUserLanguage(userId: string, language: Language) {
  await query(
    `
      UPDATE users
      SET language = $2,
          language_selected = TRUE,
          last_activity_at = NOW()
      WHERE user_id = $1
    `,
    [userId, language],
  );
}

export async function checkAndResetDailyRequests(userId: string) {
  return withTransaction(async (client) => resetDailyRequestsInClient(client, userId));
}

export function freeLeft(user: UserRecord) {
  return Math.max(0, FREE_REQUESTS_PER_DAY - Number(user.free_requests_used_today));
}

export async function canMakeRequest(userId: string, cost = REQUEST_COST): Promise<RequestAccess> {
  return withTransaction(async (client) => {
    await resetDailyRequestsInClient(client, userId);
    const user = await getUserInClient(client, userId);
    if (!user) {
      return { canUse: false, type: "user_not_found", remaining: 0, cost };
    }

    if (user.free_requests_used_today < FREE_REQUESTS_PER_DAY) {
      return {
        canUse: true,
        type: "free",
        remaining: FREE_REQUESTS_PER_DAY - user.free_requests_used_today - 1,
        cost: 0,
      };
    }

    if (user.credit_balance >= cost) {
      return { canUse: true, type: "credits", remaining: user.credit_balance - cost, cost };
    }

    if (user.credit_balance > 0) {
      return { canUse: false, type: "not_enough_credits", remaining: 0, cost };
    }

    return { canUse: false, type: "limit_reached", remaining: null, cost };
  });
}

export async function useRequest(userId: string, cost = REQUEST_COST): Promise<ChargeResult> {
  return withTransaction(async (client) => {
    await resetDailyRequestsInClient(client, userId);

    const freeResult = await client.query<UserRecord>(
      `
        UPDATE users
        SET free_requests_used_today = free_requests_used_today + 1,
            last_activity_at = NOW()
        WHERE user_id = $1
          AND free_requests_used_today < $2
        RETURNING *
      `,
      [userId, FREE_REQUESTS_PER_DAY],
    );

    const freeUser = rowToUser(freeResult.rows[0]);
    if (freeUser) {
      return {
        success: true,
        type: "free",
        remaining: freeLeft(freeUser),
        cost: 0,
        balance: freeUser.credit_balance,
      };
    }

    const creditResult = await client.query<Pick<UserRecord, "credit_balance">>(
      `
        UPDATE users
        SET credit_balance = credit_balance - $2,
            total_credits_spent = total_credits_spent + $2,
            last_activity_at = NOW()
        WHERE user_id = $1
          AND credit_balance >= $2
        RETURNING credit_balance
      `,
      [userId, cost],
    );

    if (creditResult.rowCount === 1) {
      await client.query(
        `
          INSERT INTO credit_transactions (user_id, amount, type, description, created_at)
          VALUES ($1, $2, 'spent', 'AI request', NOW())
        `,
        [userId, -cost],
      );

      return {
        success: true,
        type: "credits",
        remaining: Number(creditResult.rows[0].credit_balance),
        cost,
        balance: Number(creditResult.rows[0].credit_balance),
      };
    }

    const user = await getUserInClient(client, userId);
    return {
      success: false,
      type: user && user.credit_balance > 0 ? "not_enough_credits" : "limit_reached",
      remaining: 0,
      cost,
      balance: user?.credit_balance ?? 0,
    };
  });
}

export async function createPayment(userId: string, packageKey: PackageKey) {
  const pack = PACKAGES[packageKey];
  const result = await query<{ id: number }>(
    `
      INSERT INTO payments (user_id, amount_usd, credits_amount, status, created_at)
      VALUES ($1, $2, $3, 'pending', NOW())
      RETURNING id
    `,
    [userId, pack.price, pack.credits],
  );
  return Number(result.rows[0].id);
}

export async function updatePayment(
  paymentId: number,
  status: string,
  providerInvoiceId?: string | null,
  providerInvoiceUrl?: string | null,
) {
  await query(
    `
      UPDATE payments
      SET status = $2,
          provider_invoice_id = COALESCE($3, provider_invoice_id),
          provider_invoice_url = COALESCE($4, provider_invoice_url)
      WHERE id = $1
    `,
    [paymentId, status, providerInvoiceId, providerInvoiceUrl],
  );
}

export async function getPayment(paymentId: number) {
  const result = await query<PaymentRecord>("SELECT * FROM payments WHERE id = $1", [paymentId]);
  return rowToPayment(result.rows[0]);
}

export async function getPaymentByInvoice(invoiceId: string) {
  const result = await query<PaymentRecord>("SELECT * FROM payments WHERE provider_invoice_id = $1", [invoiceId]);
  return rowToPayment(result.rows[0]);
}

async function awardPaidReferralInClient(client: PoolClient, userId: string) {
  const userResult = await client.query<
    Pick<UserRecord, "user_id" | "referred_by" | "referral_payment_awarded">
  >(
    `
      SELECT user_id, referred_by, referral_payment_awarded
      FROM users
      WHERE user_id = $1
      FOR UPDATE
    `,
    [userId],
  );
  const user = rowToUser(userResult.rows[0] as UserRecord | undefined);
  const referrerId = user?.referred_by;
  if (!user || !referrerId || user.referral_payment_awarded || referrerId === user.user_id) {
    return null;
  }

  const referrer = await client.query("SELECT user_id FROM users WHERE user_id = $1", [referrerId]);
  if (!referrer.rowCount) {
    return null;
  }

  const markResult = await client.query(
    `
      UPDATE users
      SET referral_payment_awarded = TRUE,
          last_activity_at = NOW()
      WHERE user_id = $1
        AND referral_payment_awarded = FALSE
        AND referred_by = $2
    `,
    [userId, referrerId],
  );
  if (markResult.rowCount !== 1) {
    return null;
  }

  await client.query(
    `
      UPDATE users
      SET credit_balance = credit_balance + $2,
          paid_referral_count = paid_referral_count + 1,
          last_activity_at = NOW()
      WHERE user_id = $1
    `,
    [referrerId, REFERRAL_PAYMENT_BONUS],
  );
  await client.query(
    `
      INSERT INTO credit_transactions (user_id, amount, type, description, created_at)
      VALUES ($1, $2, 'referral_payment_bonus', 'Friend topped up balance', NOW())
    `,
    [referrerId, REFERRAL_PAYMENT_BONUS],
  );
  return referrerId;
}

export async function processPayment(paymentId: number) {
  return withTransaction(async (client) => {
    const paymentResult = await client.query<PaymentRecord>(
      "SELECT * FROM payments WHERE id = $1 FOR UPDATE",
      [paymentId],
    );
    const payment = rowToPayment(paymentResult.rows[0]);
    if (!payment || payment.status === "paid") {
      return false;
    }

    const updateResult = await client.query(
      `
        UPDATE payments
        SET status = 'paid',
            paid_at = NOW()
        WHERE id = $1
          AND status <> 'paid'
      `,
      [paymentId],
    );
    if (updateResult.rowCount !== 1) {
      return false;
    }

    await client.query(
      `
        UPDATE users
        SET credit_balance = credit_balance + $2,
            total_credits_purchased = total_credits_purchased + $2,
            last_activity_at = NOW()
        WHERE user_id = $1
      `,
      [payment.user_id, payment.credits_amount],
    );
    await client.query(
      `
        INSERT INTO credit_transactions (user_id, amount, type, description, payment_id, created_at)
        VALUES ($1, $2, 'purchase', $3, $4, NOW())
      `,
      [payment.user_id, payment.credits_amount, `Package $${payment.amount_usd}`, paymentId],
    );

    await awardPaidReferralInClient(client, payment.user_id);
    return true;
  });
}

export async function awardReferralIfNeeded(userId: string) {
  return withTransaction(async (client) => {
    const userResult = await client.query<
      Pick<UserRecord, "user_id" | "referred_by" | "referral_awarded">
    >(
      `
        SELECT user_id, referred_by, referral_awarded
        FROM users
        WHERE user_id = $1
        FOR UPDATE
      `,
      [userId],
    );
    const user = rowToUser(userResult.rows[0] as UserRecord | undefined);
    const referrerId = user?.referred_by;
    if (!user || !referrerId || user.referral_awarded || referrerId === user.user_id) {
      return null;
    }

    const referrer = await client.query("SELECT user_id FROM users WHERE user_id = $1", [referrerId]);
    if (!referrer.rowCount) {
      return null;
    }

    const markResult = await client.query(
      `
        UPDATE users
        SET referral_awarded = TRUE,
            last_activity_at = NOW()
        WHERE user_id = $1
          AND referral_awarded = FALSE
          AND referred_by = $2
          AND referred_by <> user_id
      `,
      [userId, referrerId],
    );
    if (markResult.rowCount !== 1) {
      return null;
    }

    await client.query(
      `
        UPDATE users
        SET referral_count = referral_count + 1,
            credit_balance = credit_balance + $2,
            last_activity_at = NOW()
        WHERE user_id = $1
      `,
      [referrerId, REFERRAL_BONUS],
    );
    await client.query(
      `
        INSERT INTO credit_transactions (user_id, amount, type, description, created_at)
        VALUES ($1, $2, 'referral_bonus', $3, NOW())
      `,
      [referrerId, REFERRAL_BONUS, `Invited user ${userId}`],
    );
    return referrerId;
  });
}
