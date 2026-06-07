import { NextResponse } from "next/server";
import { createChatCompletion } from "@/lib/llm";

const MAX_MESSAGE_LENGTH = 4000;

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = typeof (body as { message?: unknown }).message === "string"
    ? (body as { message: string }).message.trim()
    : "";

  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    return NextResponse.json({ error: "Message is too long" }, { status: 413 });
  }

  try {
    const result = await createChatCompletion(message);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI service unavailable";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
