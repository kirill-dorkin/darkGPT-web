const BASE_URL = (process.env.CRYPTO_PAY_BASE_URL || "https://pay.crypt.bot/api").replace(/\/+$/, "");
const DEFAULT_TIMEOUT_MS = 10_000;

type CryptoPayEnvelope<T> = {
  ok?: boolean;
  result?: T;
  error?: string;
  description?: string;
};

type CryptoInvoice = {
  invoice_id?: string | number;
  bot_invoice_url?: string;
  mini_app_invoice_url?: string;
  web_app_invoice_url?: string;
  pay_url?: string;
  status?: string;
  paid_at?: string;
  payload?: string;
};

type InvoiceList = {
  items?: CryptoInvoice[];
};

function headers() {
  return { "Crypto-Pay-API-Token": process.env.CRYPTO_PAY_API_KEY || "" };
}

async function cryptoFetch<T>(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => null)) as CryptoPayEnvelope<T> | null;
    if (!response.ok || !data?.ok) {
      return {
        ok: false,
        error: data?.error || data?.description || `Crypto Pay request failed with ${response.status}`,
      };
    }
    return { ok: true, result: data.result };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Crypto Pay request failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function firstInvoice(result: InvoiceList | CryptoInvoice[] | undefined) {
  if (Array.isArray(result)) {
    return result[0] || null;
  }
  return result?.items?.[0] || null;
}

export async function createInvoice(
  amount: number,
  tariff: string,
  userId: string,
  paymentId: number,
  credits: number,
) {
  if (!process.env.CRYPTO_PAY_API_KEY) {
    return { success: false, error: "CRYPTO_PAY_API_KEY is not configured" };
  }

  const payloadData = {
    payment_id: paymentId,
    tariff,
    user_id: userId,
  };
  const result = await cryptoFetch<CryptoInvoice>("/createInvoice", {
    method: "POST",
    headers: {
      ...headers(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      currency_type: "fiat",
      fiat: "USD",
      amount: String(amount),
      accepted_assets: "USDT",
      payload: JSON.stringify(payloadData),
      description: `DarkGPT balance top-up: ${credits} credits`,
      allow_comments: false,
      allow_anonymous: true,
      expires_in: 3600,
    }),
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  const invoice = result.result || {};
  const invoiceUrl =
    invoice.bot_invoice_url || invoice.mini_app_invoice_url || invoice.web_app_invoice_url || invoice.pay_url || "";
  const invoiceId = invoice.invoice_id ? String(invoice.invoice_id) : "";

  return {
    success: Boolean(invoiceId && invoiceUrl),
    invoiceId,
    invoiceUrl,
    payload: invoice.payload,
    error: invoiceId && invoiceUrl ? undefined : "Crypto Pay returned an empty invoice",
  };
}

export async function getInvoice(invoiceId: string) {
  const params = new URLSearchParams({ invoice_ids: invoiceId });
  const result = await cryptoFetch<InvoiceList | CryptoInvoice[]>(`/getInvoices?${params.toString()}`, {
    method: "GET",
    headers: headers(),
  });

  if (!result.ok) {
    return { success: false, error: result.error };
  }

  const invoice = firstInvoice(result.result);
  if (!invoice) {
    return { success: false, error: "Invoice not found" };
  }

  return {
    success: true,
    status: invoice.status || "",
    paidAt: invoice.paid_at,
    payload: invoice.payload,
  };
}

export async function verifyInvoice(invoiceId: string) {
  const result = await getInvoice(invoiceId);
  if (!result.success) {
    return { verified: false, paid: false, error: result.error };
  }
  return {
    verified: true,
    paid: result.status === "paid",
    status: result.status,
    payload: result.payload,
  };
}
