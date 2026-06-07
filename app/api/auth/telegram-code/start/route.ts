import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { createTelegramLoginCode, ensureUser, getUser, parseUserId } from "@/lib/db";

function cleanBotUsername(value: string) {
  return value.replace(/^@/, "");
}

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = body as { userId?: unknown };
  const userId = parseUserId(input.userId);
  if (!userId) {
    return jsonError("User id is required", 400, "user_id_required");
  }

  try {
    await ensureUser(userId, "web");
    const user = await getUser(userId);
    if (!user) {
      return jsonError("Could not create user", 500, "user_create_failed");
    }

    const { code, record } = await createTelegramLoginCode(userId);
    if (!record) {
      return jsonError("Could not create Telegram login code", 500, "telegram_code_create_failed");
    }

    const config = appConfig(getOrigin(request));
    const botUsername = cleanBotUsername(config.telegramBotUsername || "dark2_gpt_bot");
    return NextResponse.json({
      user: publicUser(user),
      config,
      status: record.status,
      code,
      expiresAt: record.expires_at,
      botStartUrl: `https://t.me/${botUsername}?start=login_${code}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create Telegram login code";
    return jsonError(message, 500, "telegram_code_create_failed");
  }
}
