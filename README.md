# DarkGPT Web

Standalone Next.js web interface for DarkGPT. The web app mirrors the Telegram bot flow: Telegram login, RU/EN language selection, 3 free requests per day, credit balance, Crypto Bot top-ups, referrals, profile, and support links.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- OpenAI-compatible chat completions API
- PostgreSQL/Neon storage shared with the bot schema
- Crypto Bot Crypto Pay invoices

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

`DATABASE_URL` is required for runtime API routes. Use the same pooled PostgreSQL/Neon database as the bot, or a compatible PostgreSQL database. The web app creates missing tables with the bot-compatible schema if they do not exist.

## Telegram Login

Telegram Login uses the current Telegram Login JS SDK (`telegram-login.js`) with `request_access=['write']`. `BOT_TOKEN` stays server-side for legacy signed payload verification; the new SDK returns an OIDC `id_token`, which the web backend verifies against Telegram JWKS.

In @BotFather, open Bot Settings > Web Login and add the allowed URLs:

- `https://dark-gpt-web.vercel.app`
- `https://dark-gpt-web.vercel.app/api/auth/telegram/oidc`

```env
BOT_TOKEN=...
TELEGRAM_BOT_USERNAME=dark2_gpt_bot
TELEGRAM_CLIENT_ID=...
```

## Gemini Env

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require
AI_PROVIDER=gemini
AI_STANDARD_MODEL=gemini-2.5-flash
AI_STANDARD_FALLBACK_MODELS=gemini-2.5-flash-lite,gemini-2.5-pro
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_REASONING_EFFORT=none
GEMINI_FALLBACK_MODELS=gemini-2.5-flash,gemini-2.5-pro
AI_FALLBACK_PROVIDERS=openrouter
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-oss-120b:free
AI_TIMEOUT_SECONDS=45
AI_MAX_OUTPUT_TOKENS=700
```

## Optional OpenRouter Override

If `LLM_PROVIDER` is set, it has priority over `AI_PROVIDER`.

```env
LLM_PROVIDER=openrouter
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=...
LLM_MODEL=openai/gpt-oss-120b:free
LLM_FALLBACK_MODELS=
OPENROUTER_TITLE=DarkGPT Web
```

## Payments

```env
CRYPTO_PAY_API_KEY=...
CRYPTO_PAY_BASE_URL=https://pay.crypt.bot/api
```

For Crypto Bot testnet:

```env
CRYPTO_PAY_BASE_URL=https://testnet-pay.crypt.bot/api
```

## Runtime Flow

- Browser stores an anonymous web account ID in `localStorage`.
- Telegram Login switches the session to the verified Telegram user ID.
- Referral links use `?ref=<user_id>`.
- Credits are charged only after a successful AI response.
- Free daily requests reset automatically by date.
- Paid invoices are checked through `/api/payments/check` and processed idempotently.
- Gemini requests can use tier selection and automatic fallback models when a model hits rate limits.
- If all Gemini attempts fail with retryable provider errors, the web backend falls back to OpenRouter when `OPENROUTER_API_KEY` or `LLM_API_KEY` is configured.

## Git Remote

```bash
git remote add origin https://github.com/kirill-dorkin/darkGPT-web.git
git push -u origin main
```
