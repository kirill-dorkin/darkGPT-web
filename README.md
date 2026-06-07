# DarkGPT Web

Standalone Next.js web interface for DarkGPT.

## Stack

- Next.js App Router
- React
- Tailwind CSS
- OpenAI-compatible chat completions API

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Gemini Env

```env
AI_PROVIDER=gemini
AI_STANDARD_MODEL=gemini-2.5-flash-lite
GEMINI_API_KEY=...
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
GEMINI_REASONING_EFFORT=none
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

## Git Remote

```bash
git remote add origin https://github.com/kirill-dorkin/darkGPT-web.git
git push -u origin main
```
