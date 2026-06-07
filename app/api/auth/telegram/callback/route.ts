import { NextResponse } from "next/server";
import { getOrigin } from "@/lib/api";
import { ensureUser, getUser, parseUserId, updateUserLanguage } from "@/lib/db";
import {
  normalizeTelegramAuthData,
  telegramDisplayName,
  verifyTelegramAuthData,
} from "@/lib/telegram-auth";

function redirectToApp(request: Request, params: Record<string, string>) {
  const target = new URL("/", getOrigin(request));
  for (const [key, value] of Object.entries(params)) {
    target.searchParams.set(key, value);
  }
  return NextResponse.redirect(target);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const authData = normalizeTelegramAuthData(Object.fromEntries(url.searchParams.entries()));
  if (!authData) {
    console.warn("[telegram-auth] callback invalid payload", {
      origin: getOrigin(request),
      keys: Array.from(url.searchParams.keys()).sort(),
    });
    return redirectToApp(request, {
      telegramLogin: "failed",
      telegramError: "telegram_payload_invalid",
    });
  }

  const verification = verifyTelegramAuthData(authData, process.env.BOT_TOKEN || "");
  if (!verification.ok) {
    console.warn("[telegram-auth] callback verification failed", {
      reason: verification.reason,
      telegramUserId: authData.id,
    });
    return redirectToApp(request, {
      telegramLogin: "failed",
      telegramError: "telegram_auth_failed",
    });
  }

  const telegramUserId = authData.id;
  const currentUserId = parseUserId(url.searchParams.get("currentUserId"));
  const username = telegramDisplayName(authData);

  try {
    const currentUser = currentUserId && currentUserId !== telegramUserId ? await getUser(currentUserId) : null;
    await ensureUser(telegramUserId, username);

    const telegramUser = await getUser(telegramUserId);
    if (currentUser?.language_selected && currentUser.language && telegramUser && !telegramUser.language_selected) {
      await updateUserLanguage(telegramUserId, currentUser.language);
    }

    console.info("[telegram-auth] callback success", {
      telegramUserId,
      currentUserId: currentUserId || null,
      hasUsername: Boolean(authData.username),
    });
    return redirectToApp(request, {
      telegramLogin: "success",
      telegramUserId,
    });
  } catch (error) {
    console.error("[telegram-auth] callback storage failure", {
      telegramUserId,
      currentUserId: currentUserId || null,
      error: error instanceof Error ? error.message : "unknown",
    });
    return redirectToApp(request, {
      telegramLogin: "failed",
      telegramError: "telegram_login_failed",
    });
  }
}
