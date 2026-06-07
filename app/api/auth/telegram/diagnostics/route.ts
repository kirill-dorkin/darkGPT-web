import { NextResponse } from "next/server";
import { getOrigin } from "@/lib/api";
import { parseUserId } from "@/lib/db";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "warning" | "error";

type DiagnosticCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

function pickLanguage(value: string | null) {
  return value === "en" ? "en" : "ru";
}

function text(language: string, ru: string, en: string) {
  return language === "en" ? en : ru;
}

function tokenBotId(token: string) {
  const id = token.split(":")[0] || "";
  return /^\d+$/.test(id) ? id : "";
}

function telegramClientId(botId: string) {
  const configured = process.env.TELEGRAM_CLIENT_ID || "";
  return /^\d+$/.test(configured) ? configured : botId;
}

function check(id: string, label: string, status: CheckStatus, detail: string): DiagnosticCheck {
  return { id, label, status, detail };
}

async function fetchText(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "DarkGPT-Web-Diagnostics/1.0" },
      signal: controller.signal,
      cache: "no-store",
    });
    return { response, body: await response.text() };
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const language = pickLanguage(requestUrl.searchParams.get("language"));
  const origin = getOrigin(request);
  const currentUserId = parseUserId(requestUrl.searchParams.get("currentUserId"));

  const botToken = process.env.BOT_TOKEN || "";
  const botId = tokenBotId(botToken);
  const clientId = telegramClientId(botId);
  const configuredUsername = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const checks: DiagnosticCheck[] = [];

  const callbackUrl = new URL("/api/auth/telegram/callback", origin);
  if (currentUserId) {
    callbackUrl.searchParams.set("currentUserId", currentUserId);
  }

  const oauthUrl = new URL("https://oauth.telegram.org/auth");
  if (clientId) {
    oauthUrl.searchParams.set("response_type", "post_message");
    oauthUrl.searchParams.set("client_id", clientId);
    oauthUrl.searchParams.set("redirect_uri", origin);
    oauthUrl.searchParams.set("scope", "openid profile telegram:bot_access");
    oauthUrl.searchParams.set("request_access", "write");
    oauthUrl.searchParams.set("origin", origin);
  }

  checks.push(
    check(
      "bot_token",
      text(language, "BOT_TOKEN", "BOT_TOKEN"),
      botToken ? "ok" : "error",
      botToken
        ? text(language, "Токен есть на сервере. Значение наружу не отдаётся.", "The token is present on the server. The value is not exposed.")
        : text(language, "BOT_TOKEN не задан в переменных окружения Vercel.", "BOT_TOKEN is missing from Vercel environment variables."),
    ),
  );

  checks.push(
    check(
      "client_id",
      text(language, "Client ID", "Client ID"),
      clientId ? "ok" : "error",
      clientId
        ? text(language, `Telegram Login client_id: ${clientId}.`, `Telegram Login client_id: ${clientId}.`)
        : text(language, "TELEGRAM_CLIENT_ID не задан и его не удалось собрать из BOT_TOKEN.", "TELEGRAM_CLIENT_ID is missing and could not be derived from BOT_TOKEN."),
    ),
  );

  checks.push(
    check(
      "bot_id",
      text(language, "Bot ID", "Bot ID"),
      botId ? "ok" : "error",
      botId
        ? text(language, `Публичный bot_id собран из токена: ${botId}.`, `Public bot_id derived from the token: ${botId}.`)
        : text(language, "Не удалось получить числовой bot_id из BOT_TOKEN.", "Could not derive a numeric bot_id from BOT_TOKEN."),
    ),
  );

  checks.push(
    check(
      "origin",
      text(language, "Домен сайта", "Site domain"),
      origin.startsWith("https://") ? "ok" : "error",
      origin.startsWith("https://")
        ? text(language, `Origin для Telegram: ${origin}.`, `Telegram origin: ${origin}.`)
        : text(language, `Telegram Login требует HTTPS. Сейчас origin: ${origin}.`, `Telegram Login requires HTTPS. Current origin: ${origin}.`),
    ),
  );

  checks.push(
    check(
      "callback_url",
      text(language, "Callback", "Callback"),
      callbackUrl.origin === origin ? "ok" : "error",
      text(language, `Callback вернёт пользователя на ${callbackUrl.origin}.`, `Callback returns the user to ${callbackUrl.origin}.`),
    ),
  );

  checks.push(
    check(
      "write_access",
      text(language, "Доступ Telegram", "Telegram access"),
      "ok",
      text(
        language,
        "Popup URL содержит request_access=write, scope=telegram:bot_access и origin сайта.",
        "Popup URL contains request_access=write, scope=telegram:bot_access, and the site origin.",
      ),
    ),
  );

  let botApiUsername = "";
  let botApiId = "";
  if (botToken) {
    try {
      const botApiUrl = `https://api.telegram.org/bot${botToken}/getMe`;
      const { response, body } = await fetchText(botApiUrl);
      const payload = JSON.parse(body) as {
        ok?: boolean;
        description?: string;
        result?: { id?: number; username?: string };
      };
      botApiUsername = payload.result?.username || "";
      botApiId = payload.result?.id ? String(payload.result.id) : "";
      const idMatches = Boolean(botId && botApiId && botId === botApiId);
      checks.push(
        check(
          "bot_api",
          text(language, "Telegram Bot API", "Telegram Bot API"),
          response.ok && payload.ok && idMatches ? "ok" : "error",
          response.ok && payload.ok
            ? idMatches
              ? text(language, `Bot API отвечает: @${botApiUsername}, id совпадает.`, `Bot API responds: @${botApiUsername}, id matches.`)
              : text(language, `Bot API отвечает, но id не совпадает: token=${botId || "-"}, getMe=${botApiId || "-"}.`, `Bot API responds, but id does not match: token=${botId || "-"}, getMe=${botApiId || "-"}.`)
            : text(language, `Bot API вернул ошибку: ${payload.description || response.status}.`, `Bot API returned an error: ${payload.description || response.status}.`),
        ),
      );
      if (configuredUsername && botApiUsername) {
        checks.push(
          check(
            "bot_username",
            text(language, "Username бота", "Bot username"),
            configuredUsername.toLowerCase() === botApiUsername.toLowerCase() ? "ok" : "warning",
            configuredUsername.toLowerCase() === botApiUsername.toLowerCase()
              ? text(language, `TELEGRAM_BOT_USERNAME совпадает: @${botApiUsername}.`, `TELEGRAM_BOT_USERNAME matches: @${botApiUsername}.`)
              : text(language, `В .env указано @${configuredUsername}, Bot API вернул @${botApiUsername}.`, `.env has @${configuredUsername}, Bot API returned @${botApiUsername}.`),
          ),
        );
      }
    } catch (error) {
      checks.push(
        check(
          "bot_api",
          text(language, "Telegram Bot API", "Telegram Bot API"),
          "error",
          error instanceof Error
            ? text(language, `Не удалось проверить Bot API: ${error.message}.`, `Could not check Bot API: ${error.message}.`)
            : text(language, "Не удалось проверить Bot API.", "Could not check Bot API."),
        ),
      );
    }
  }

  if (clientId) {
    try {
      const { response: authResponse, body: authBody } = await fetchText(oauthUrl.toString());
      const requestUrlIncludesAccess = authBody.includes("request_access=write");
      checks.push(
        check(
          "popup_origin",
          text(language, "Origin в popup", "Popup origin"),
          authResponse.ok && !authBody.includes("origin required") ? "ok" : "error",
          authResponse.ok && !authBody.includes("origin required")
            ? text(language, "Telegram OAuth больше не отвечает origin required.", "Telegram OAuth no longer responds with origin required.")
            : text(language, "Telegram OAuth всё ещё отвечает origin required.", "Telegram OAuth still responds with origin required."),
        ),
      );
      checks.push(
        check(
          "popup_request_access",
          text(language, "Confirm message", "Confirm message"),
          authResponse.ok && requestUrlIncludesAccess ? "ok" : "warning",
          authResponse.ok && requestUrlIncludesAccess
            ? text(
                language,
                "Telegram popup передаст request_access=write во внутренние /auth/request и /auth/login.",
                "Telegram popup will pass request_access=write to the internal /auth/request and /auth/login calls.",
              )
            : text(
                language,
                "Telegram popup не показал request_access=write во внутренних запросах.",
                "Telegram popup did not expose request_access=write in internal requests.",
              ),
        ),
      );

      checks.push(
        check(
          "web_login_allowed_urls",
          text(language, "BotFather Web Login", "BotFather Web Login"),
          "warning",
          text(
            language,
            "Это нельзя проверить сервером. В @BotFather > Bot Settings > Web Login должен быть Allowed URL: https://dark-gpt-web.vercel.app.",
            "This cannot be checked server-side. In @BotFather > Bot Settings > Web Login, Allowed URL must include https://dark-gpt-web.vercel.app.",
          ),
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "oauth_page",
          text(language, "Telegram OAuth", "Telegram OAuth"),
          "error",
          error instanceof Error
            ? text(language, `Не удалось загрузить Telegram OAuth: ${error.message}.`, `Could not load Telegram OAuth: ${error.message}.`)
            : text(language, "Не удалось загрузить Telegram OAuth.", "Could not load Telegram OAuth."),
        ),
      );
    }
  }

  const ok = checks.every((item) => item.status !== "error");
  const response = {
    ok,
    checkedAt: new Date().toISOString(),
    origin,
    callbackUrl: callbackUrl.toString(),
    oauthUrl: oauthUrl.toString(),
    bot: {
      id: botId || null,
      username: botApiUsername || configuredUsername || null,
      clientId: clientId || null,
    },
    checks,
    summary: ok
      ? text(
          language,
          "Кнопка открывает Telegram OAuth popup с origin и request_access=write. Если подтверждение всё равно не приходит, проверь BotFather Web Login Allowed URLs.",
          "The button opens Telegram OAuth popup with origin and request_access=write. If the confirmation still does not arrive, check BotFather Web Login Allowed URLs.",
        )
      : text(language, "Есть ошибка в конфигурации Telegram Login. Смотри красную проверку ниже.", "There is a Telegram Login configuration error. See the red check below."),
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
