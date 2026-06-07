import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, refreshedPublicUser } from "@/lib/api";
import { verifyInvoice } from "@/lib/crypto-pay";
import { getPayment, parseUserId, processPayment, updatePayment } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { userId?: unknown; paymentId?: unknown };
  const userId = parseUserId(input.userId);
  const paymentId = Number.parseInt(String(input.paymentId || ""), 10);

  if (!userId) {
    return jsonError("userId is required", 400, "user_required");
  }
  if (!Number.isFinite(paymentId)) {
    return jsonError("paymentId is required", 400, "payment_required");
  }

  try {
    const payment = await getPayment(paymentId);
    if (!payment || payment.user_id !== userId || !payment.provider_invoice_id) {
      return jsonError("Payment not found", 404, "payment_not_found");
    }

    const verifyResult = await verifyInvoice(payment.provider_invoice_id);
    if (verifyResult.paid) {
      await processPayment(payment.id);
      const user = await refreshedPublicUser(userId);
      return NextResponse.json({
        status: "paid",
        credits: payment.credits_amount,
        balance: user?.balance || 0,
        user,
        config: appConfig(getOrigin(request)),
      });
    }

    if (verifyResult.status === "expired") {
      await updatePayment(payment.id, "expired");
      const user = await refreshedPublicUser(userId);
      return NextResponse.json({
        status: "expired",
        user,
        config: appConfig(getOrigin(request)),
      });
    }

    const user = await refreshedPublicUser(userId);
    return NextResponse.json({
      status: "pending",
      user,
      config: appConfig(getOrigin(request)),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check payment";
    return jsonError(message, 500, "payment_check_failed");
  }
}
