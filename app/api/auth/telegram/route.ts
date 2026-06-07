import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { ensureUser, getUser, parseUserId, updateUserLanguage } from "@/lib/db";
import {
  normalizeTelegramAuthData,
  telegramDisplayName,
  verifyTelegramAuthData,
} from "@/lib/telegram-auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { authData?: unknown; currentUserId?: unknown };
  const authData = normalizeTelegramAuthData(input.authData);
  if (!authData) {
    return jsonError("Telegram auth payload is invalid", 400, "telegram_payload_invalid");
  }

  const verification = verifyTelegramAuthData(authData, process.env.BOT_TOKEN || "");
  if (!verification.ok) {
    return jsonError(verification.reason, 401, "telegram_auth_failed");
  }

  const telegramUserId = authData.id;
  const currentUserId = parseUserId(input.currentUserId);
  const username = telegramDisplayName(authData);

  try {
    const currentUser = currentUserId && currentUserId !== telegramUserId ? await getUser(currentUserId) : null;
    await ensureUser(telegramUserId, username);

    const telegramUser = await getUser(telegramUserId);
    if (currentUser?.language_selected && currentUser.language && telegramUser && !telegramUser.language_selected) {
      await updateUserLanguage(telegramUserId, currentUser.language);
    }

    const user = await getUser(telegramUserId);
    if (!user) {
      return jsonError("Could not create Telegram user", 500, "user_create_failed");
    }

    return NextResponse.json({
      user: publicUser(user),
      config: appConfig(getOrigin(request)),
      telegram: {
        id: authData.id,
        username: authData.username || null,
        firstName: authData.first_name || null,
        lastName: authData.last_name || null,
        photoUrl: authData.photo_url || null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not log in with Telegram";
    return jsonError(message, 500, "telegram_login_failed");
  }
}
