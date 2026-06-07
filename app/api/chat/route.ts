import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, refreshedPublicUser } from "@/lib/api";
import { FREE_REQUESTS_PER_DAY, MAX_REQUEST_LENGTH } from "@/lib/constants";
import { canMakeRequest, ensureUser, getUser, parseUserId, useRequest as chargeRequest } from "@/lib/db";
import { createChatCompletion } from "@/lib/llm";
import { getModelProfile } from "@/lib/model-router";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { userId?: unknown; message?: unknown; tier?: unknown };
  const userId = parseUserId(input.userId);
  const message = typeof input.message === "string" ? input.message.trim() : "";
  const tier = typeof input.tier === "string" ? input.tier : undefined;

  if (!userId) {
    return jsonError("userId is required", 400, "user_required");
  }
  if (!message) {
    return jsonError("Message is required", 400, "message_required");
  }
  if (message.length > MAX_REQUEST_LENGTH) {
    return jsonError("Message is too long", 413, "request_too_long");
  }

  try {
    await ensureUser(userId, "web");
    const user = await getUser(userId);
    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }
    if (!user.language_selected) {
      return jsonError("Language is required", 428, "language_required");
    }

    const profile = getModelProfile(tier);
    const access = await canMakeRequest(userId, profile.credits);
    if (!access.canUse) {
      const status = access.type === "not_enough_credits" ? 402 : 429;
      const publicProfile = await refreshedPublicUser(userId);
      return jsonError(access.type, status, access.type, {
        user: publicProfile,
        freeTotal: FREE_REQUESTS_PER_DAY,
        cost: profile.credits,
      });
    }

    const result = await createChatCompletion(message, profile.tier);
    const charge = await chargeRequest(userId, profile.credits);
    if (!charge.success) {
      const status = charge.type === "not_enough_credits" ? 402 : 429;
      const publicProfile = await refreshedPublicUser(userId);
      return jsonError(charge.type, status, charge.type, {
        user: publicProfile,
        freeTotal: FREE_REQUESTS_PER_DAY,
        cost: profile.credits,
      });
    }

    const publicProfile = await refreshedPublicUser(userId);
    return NextResponse.json({
      ...result,
      chargeType: charge.type,
      remaining: charge.remaining,
      cost: charge.cost,
      balance: charge.balance,
      user: publicProfile,
      config: appConfig(getOrigin(request)),
    });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "AI service unavailable";
    const publicProfile = userId ? await refreshedPublicUser(userId).catch(() => null) : null;
    return jsonError(messageText, 502, "ai_unavailable", { user: publicProfile });
  }
}
