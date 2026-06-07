import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { getTelegramLoginCodeStatus, getUser, normalizeTelegramLoginCode, parseUserId } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = body as { userId?: unknown; code?: unknown };
  const userId = parseUserId(input.userId);
  const code = normalizeTelegramLoginCode(input.code);
  if (!userId || !code) {
    return jsonError("Telegram login code is required", 400, "telegram_code_required");
  }

  try {
    const record = await getTelegramLoginCodeStatus(userId, code);
    if (!record) {
      return jsonError("Telegram login code was not found", 404, "telegram_code_not_found", {
        status: "not_found",
      });
    }

    if (record.status !== "confirmed" || !record.telegram_user_id) {
      return NextResponse.json({
        config: appConfig(getOrigin(request)),
        status: record.status,
        expiresAt: record.expires_at,
      });
    }

    const user = await getUser(record.telegram_user_id);
    if (!user) {
      return jsonError("Could not load Telegram user", 500, "telegram_user_not_found");
    }

    return NextResponse.json({
      user: publicUser(user),
      config: appConfig(getOrigin(request)),
      status: "confirmed",
      telegramUserId: record.telegram_user_id,
      telegramUsername: record.telegram_username,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not check Telegram login code";
    return jsonError(message, 500, "telegram_code_check_failed");
  }
}
