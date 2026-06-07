import { NextResponse } from "next/server";
import { appConfig, getOrigin, jsonError, refreshedPublicUser } from "@/lib/api";
import { parseUserId } from "@/lib/db";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = parseUserId(url.searchParams.get("userId"));
  if (!userId) {
    return jsonError("userId is required", 400, "user_required");
  }

  try {
    const user = await refreshedPublicUser(userId);
    if (!user) {
      return jsonError("User not found", 404, "user_not_found");
    }
    return NextResponse.json({ user, config: appConfig(getOrigin(request)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load user";
    return jsonError(message, 500, "profile_failed");
  }
}
