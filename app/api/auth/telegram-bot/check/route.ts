import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { getUser, getWebLoginToken, parseUserId, parseWebLoginToken, updateUserLanguage } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { token?: unknown; currentUserId?: unknown };
  const token = parseWebLoginToken(input.token);
  if (!token) {
    return jsonError("Telegram bot login token is invalid", 400, "telegram_bot_token_invalid");
  }

  try {
    const login = await getWebLoginToken(token);
    if (!login) {
      return NextResponse.json({ status: "expired", config: appConfig(getOrigin(request)) });
    }

    if (new Date(login.expires_at).getTime() <= Date.now()) {
      return NextResponse.json({ status: "expired", config: appConfig(getOrigin(request)) });
    }

    if (!login.telegram_user_id) {
      return NextResponse.json({ status: "pending", config: appConfig(getOrigin(request)) });
    }

    const telegramUserId = login.telegram_user_id;
    const currentUserId = parseUserId(input.currentUserId);
    const currentUser = currentUserId && currentUserId !== telegramUserId ? await getUser(currentUserId) : null;
    const telegramUser = await getUser(telegramUserId);

    if (currentUser?.language_selected && currentUser.language && telegramUser && !telegramUser.language_selected) {
      await updateUserLanguage(telegramUserId, currentUser.language);
    }

    const user = await getUser(telegramUserId);
    if (!user) {
      return jsonError("Could not load Telegram user", 500, "user_load_failed");
    }

    return NextResponse.json({
      status: "connected",
      user: publicUser(user),
      config: appConfig(getOrigin(request)),
      telegram: {
        id: telegramUserId,
        username: login.telegram_username || user.username || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check Telegram bot login";
    return jsonError(message, 500, "telegram_bot_login_check_failed");
  }
}
