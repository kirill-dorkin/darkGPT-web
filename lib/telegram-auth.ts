import { createHash, createHmac, timingSafeEqual } from "crypto";

export type TelegramAuthData = {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: string;
  hash: string;
};

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

function stringField(value: unknown) {
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeTelegramAuthData(value: unknown): TelegramAuthData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const input = value as Record<string, unknown>;
  const data = {
    id: stringField(input.id),
    first_name: stringField(input.first_name) || undefined,
    last_name: stringField(input.last_name) || undefined,
    username: stringField(input.username) || undefined,
    photo_url: stringField(input.photo_url) || undefined,
    auth_date: stringField(input.auth_date),
    hash: stringField(input.hash),
  };

  if (!/^\d{4,18}$/.test(data.id) || !/^\d+$/.test(data.auth_date) || !/^[a-f0-9]{64}$/i.test(data.hash)) {
    return null;
  }

  return data;
}

export function verifyTelegramAuthData(data: TelegramAuthData, botToken: string) {
  if (!botToken) {
    return { ok: false, reason: "BOT_TOKEN is not configured" };
  }

  const authAge = Math.floor(Date.now() / 1000) - Number(data.auth_date);
  if (!Number.isFinite(authAge) || authAge < 0 || authAge > MAX_AUTH_AGE_SECONDS) {
    return { ok: false, reason: "Telegram authorization expired" };
  }

  const entries = Object.entries(data)
    .filter(([key, value]) => key !== "hash" && value !== undefined && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`);
  const dataCheckString = entries.join("\n");
  const secretKey = createHash("sha256").update(botToken).digest();
  const calculatedHash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const received = Buffer.from(data.hash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");
  if (received.length !== calculated.length || !timingSafeEqual(received, calculated)) {
    return { ok: false, reason: "Telegram authorization hash is invalid" };
  }

  return { ok: true, reason: "" };
}

export function telegramDisplayName(data: TelegramAuthData) {
  return data.username || [data.first_name, data.last_name].filter(Boolean).join(" ").trim() || "telegram";
}
