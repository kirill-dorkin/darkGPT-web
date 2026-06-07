import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { createWebLoginToken, ensureUser, generateUserId, getUser, parseReferralArg, parseUserId } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = body as { currentUserId?: unknown; referralId?: unknown };
  const existingUserId = parseUserId(input.currentUserId);
  const userId = existingUserId || (await generateUserId());
  const referralId = parseReferralArg(input.referralId);

  try {
    await ensureUser(userId, "web", referralId);
    const user = await getUser(userId);
    if (!user) {
      return jsonError("Could not create user", 500, "user_create_failed");
    }

    const config = appConfig(getOrigin(request));
    const botUsername = config.telegramBotUsername.replace(/^@/, "");
    if (!botUsername) {
      return jsonError("Telegram Login is not configured", 500, "telegram_login_unavailable");
    }

    const login = await createWebLoginToken(userId);
    return NextResponse.json({
      user: publicUser(user),
      config,
      botLogin: {
        token: login.token,
        botUrl: `https://t.me/${botUsername}?start=web_${login.token}`,
        expiresAt: login.expiresAt.toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not start Telegram bot login";
    return jsonError(message, 500, "telegram_bot_login_start_failed");
  }
}
