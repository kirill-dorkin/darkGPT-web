import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, publicUser } from "@/lib/api";
import { ensureUser, generateUserId, getUser, parseReferralArg, parseUserId } from "@/lib/db";

export async function POST(request: Request) {
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const input = body as { userId?: unknown; referralId?: unknown };
  const existingUserId = parseUserId(input.userId);
  const userId = existingUserId || (await generateUserId());
  const referralId = parseReferralArg(input.referralId);

  try {
    await ensureUser(userId, "web", referralId);
    const user = await getUser(userId);
    if (!user) {
      return jsonError("Could not create user", 500, "user_create_failed");
    }

    return NextResponse.json({
      user: publicUser(user),
      config: appConfig(getOrigin(request)),
      created: !existingUserId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create session";
    return jsonError(message, 500, "session_failed");
  }
}
