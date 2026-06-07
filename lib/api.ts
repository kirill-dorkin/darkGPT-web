import { NextResponse } from "next/server";
import { FREE_REQUESTS_PER_DAY, PACKAGES, REQUEST_COST, SUPPORT_USERNAME, type Language } from "@/lib/constants";
import { UserRecord, checkAndResetDailyRequests, freeLeft, getUser } from "@/lib/db";

export type PublicUser = {
  userId: string;
  language: Language | null;
  languageSelected: boolean;
  freeUsedToday: number;
  freeLeft: number;
  freeTotal: number;
  balance: number;
  totalPurchased: number;
  totalSpent: number;
  referralCount: number;
  paidReferralCount: number;
  referredBy: string | null;
};

export function publicUser(user: UserRecord): PublicUser {
  return {
    userId: user.user_id,
    language: user.language,
    languageSelected: user.language_selected,
    freeUsedToday: user.free_requests_used_today,
    freeLeft: freeLeft(user),
    freeTotal: FREE_REQUESTS_PER_DAY,
    balance: user.credit_balance,
    totalPurchased: user.total_credits_purchased,
    totalSpent: user.total_credits_spent,
    referralCount: user.referral_count,
    paidReferralCount: user.paid_referral_count,
    referredBy: user.referred_by,
  };
}

export async function refreshedPublicUser(userId: string) {
  await checkAndResetDailyRequests(userId);
  const user = await getUser(userId);
  return user ? publicUser(user) : null;
}

export function appConfig(origin?: string) {
  return {
    freeTotal: FREE_REQUESTS_PER_DAY,
    requestCost: REQUEST_COST,
    packages: PACKAGES,
    supportUsername: SUPPORT_USERNAME,
    origin,
  };
}

export function jsonError(message: string, status = 400, code = "error", extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, code, ...extra }, { status });
}

export function getOrigin(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}
