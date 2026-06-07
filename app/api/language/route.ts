import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, refreshedPublicUser } from "@/lib/api";
import { isLanguage } from "@/lib/constants";
import { awardReferralIfNeeded, ensureUser, parseUserId, updateUserLanguage } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { userId?: unknown; language?: unknown };
  const userId = parseUserId(input.userId);
  if (!userId) {
    return jsonError("userId is required", 400, "user_required");
  }
  if (!isLanguage(input.language)) {
    return jsonError("Unsupported language", 400, "language_unsupported");
  }

  try {
    await ensureUser(userId, "web");
    await updateUserLanguage(userId, input.language);
    const awardedReferrerId = await awardReferralIfNeeded(userId);
    const user = await refreshedPublicUser(userId);
    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }

    return NextResponse.json({
      user,
      config: appConfig(getOrigin(request)),
      referralAwarded: Boolean(awardedReferrerId),
      referrerId: awardedReferrerId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update language";
    return jsonError(message, 500, "language_failed");
  }
}
