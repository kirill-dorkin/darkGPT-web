import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, refreshedPublicUser } from "@/lib/api";
import { PACKAGES, isPackageKey } from "@/lib/constants";
import { createInvoice } from "@/lib/crypto-pay";
import { createPayment, ensureUser, parseUserId, updatePayment } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { userId?: unknown; packageKey?: unknown };
  const userId = parseUserId(input.userId);
  if (!userId) {
    return jsonError("userId is required", 400, "user_required");
  }
  if (!isPackageKey(input.packageKey)) {
    return jsonError("Invalid package", 400, "invalid_package");
  }

  try {
    await ensureUser(userId, "web");
    const pack = PACKAGES[input.packageKey];
    const paymentId = await createPayment(userId, input.packageKey);
    const invoice = await createInvoice(pack.price, input.packageKey, userId, paymentId, pack.credits);

    if (!invoice.success || !invoice.invoiceId || !invoice.invoiceUrl) {
      await updatePayment(paymentId, "failed");
      return jsonError(invoice.error || "Could not create invoice", 502, "invoice_create_failed", {
        paymentId,
      });
    }

    await updatePayment(paymentId, "pending", invoice.invoiceId, invoice.invoiceUrl);
    const user = await refreshedPublicUser(userId);

    return NextResponse.json({
      paymentId,
      invoiceId: invoice.invoiceId,
      invoiceUrl: invoice.invoiceUrl,
      amountUsd: pack.price,
      credits: pack.credits,
      status: "pending",
      user,
      config: appConfig(getOrigin(request)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create invoice";
    return jsonError(message, 500, "payment_create_failed");
  }
}
