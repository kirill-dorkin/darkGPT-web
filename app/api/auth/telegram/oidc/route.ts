import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { ensureUser, getUser, parseUserId, updateUserLanguage } from "@/lib/db";
import { verifyTelegramIdToken } from "@/lib/telegram-oidc";

function telegramClientId() {
  const configured = process.env.TELEGRAM_CLIENT_ID || "";
  if (/^\d+$/.test(configured)) {
    return configured;
  }
  const tokenId = (process.env.BOT_TOKEN || "").split(":")[0] || "";
  return /^\d+$/.test(tokenId) ? tokenId : "";
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400, "invalid_json");
  }

  const input = body as { idToken?: unknown; currentUserId?: unknown };
  const idToken = typeof input.idToken === "string" ? input.idToken : "";
  if (!idToken) {
    return jsonError("Telegram id_token is required", 400, "telegram_oidc_token_required");
  }

  try {
    const telegramUser = await verifyTelegramIdToken(idToken, telegramClientId());
    const currentUserId = parseUserId(input.currentUserId);
    const username = telegramUser.username || telegramUser.name || "telegram";

    const currentUser = currentUserId && currentUserId !== telegramUser.id ? await getUser(currentUserId) : null;
    await ensureUser(telegramUser.id, username);

    const savedTelegramUser = await getUser(telegramUser.id);
    if (currentUser?.language_selected && currentUser.language && savedTelegramUser && !savedTelegramUser.language_selected) {
      await updateUserLanguage(telegramUser.id, currentUser.language);
    }

    const user = await getUser(telegramUser.id);
    if (!user) {
      return jsonError("Could not create Telegram user", 500, "user_create_failed");
    }

    console.info("[telegram-auth] oidc success", {
      telegramUserId: telegramUser.id,
      currentUserId: currentUserId || null,
      hasUsername: Boolean(telegramUser.username),
    });

    return NextResponse.json({
      user: publicUser(user),
      config: appConfig(getOrigin(request)),
      telegram: telegramUser,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not log in with Telegram";
    console.warn("[telegram-auth] oidc failed", { error: message });
    return jsonError(message, 401, "telegram_oidc_failed");
  }
}
