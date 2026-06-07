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
  const configuredUsername = (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, "");
  const checks: DiagnosticCheck[] = [];

  const callbackUrl = new URL("/api/auth/telegram/callback", origin);
  if (currentUserId) {
    callbackUrl.searchParams.set("currentUserId", currentUserId);
  }

  const oauthUrl = new URL("https://oauth.telegram.org/auth");
  if (botId) {
    oauthUrl.searchParams.set("bot_id", botId);
  }
  oauthUrl.searchParams.set("origin", origin);
  oauthUrl.searchParams.set("return_to", callbackUrl.toString());
  oauthUrl.searchParams.set("request_access", "write");

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
      oauthUrl.searchParams.get("request_access") === "write" ? "ok" : "warning",
      oauthUrl.searchParams.has("request_access")
        ? text(language, "OAuth просит request_access=write: Telegram должен показать подтверждение доступа.", "OAuth requests request_access=write: Telegram should show an access confirmation.")
        : text(language, "request_access=write не отправляется.", "request_access=write is not sent."),
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

  if (botId) {
    try {
      const { response, body } = await fetchText(oauthUrl.toString());
      const host = new URL(origin).host;
      const pageLoaded = body.includes("Telegram Authorization");
      const domainVisible = body.includes(host);
      const invalidDomain = /invalid domain|bot domain invalid/i.test(body);

      checks.push(
        check(
          "oauth_page",
          text(language, "Страница Telegram OAuth", "Telegram OAuth page"),
          response.ok && pageLoaded && !invalidDomain ? "ok" : "error",
          response.ok && pageLoaded && !invalidDomain
            ? text(language, "oauth.telegram.org открывает страницу авторизации.", "oauth.telegram.org opens the authorization page.")
            : text(language, `Telegram OAuth ответил, но страница не похожа на валидную авторизацию. HTTP ${response.status}.`, `Telegram OAuth responded, but the page does not look like valid authorization. HTTP ${response.status}.`),
        ),
      );

      checks.push(
        check(
          "domain_accepted",
          text(language, "/setdomain", "/setdomain"),
          domainVisible && !invalidDomain ? "ok" : "error",
          domainVisible && !invalidDomain
            ? text(language, `Telegram показывает домен ${host}. Значит /setdomain принят.`, `Telegram shows ${host}. That means /setdomain is accepted.`)
            : text(language, `Telegram не показал домен ${host}. Проверь /setdomain у @BotFather.`, `Telegram did not show ${host}. Check /setdomain in @BotFather.`),
        ),
      );
    } catch (error) {
      checks.push(
        check(
          "oauth_page",
          text(language, "Страница Telegram OAuth", "Telegram OAuth page"),
          "error",
          error instanceof Error
            ? text(language, `Не удалось открыть oauth.telegram.org: ${error.message}.`, `Could not open oauth.telegram.org: ${error.message}.`)
            : text(language, "Не удалось открыть oauth.telegram.org.", "Could not open oauth.telegram.org."),
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
    },
    checks,
    summary: ok
      ? text(
          language,
          "Конфиг сайта и Telegram выглядит рабочим. Если подтверждение не приходит, callback ещё не дошёл до сайта: сбой происходит внутри Telegram OAuth до возврата на сайт.",
          "The site and Telegram config look valid. If the confirmation does not arrive, the callback has not reached the site yet: the failure is inside Telegram OAuth before returning to the site.",
        )
      : text(language, "Есть ошибка в конфигурации Telegram Login. Смотри красную проверку ниже.", "There is a Telegram Login configuration error. See the red check below."),
  };

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
