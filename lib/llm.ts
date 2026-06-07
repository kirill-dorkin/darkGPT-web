type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ProviderConfig = {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  fallbackModels: string[];
  timeoutMs: number;
  maxTokens: number;
  reasoningEffort: string;
  title: string;
  referer: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      refusal?: string | null;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string | number;
  } | string;
};

const DEFAULT_SYSTEM_PROMPT = [
  "Ты веб-ассистент DarkGPT.",
  "Отвечай на языке пользователя: кратко, по делу, с нормальной структурой.",
  "Используй Markdown: заголовки, списки, таблицы и fenced code blocks, когда это помогает.",
  "Если запрос просит вредоносные инструкции, кражу данных, фишинг, скрытое наблюдение или эксплуатацию чужих систем, кратко откажи и предложи безопасную альтернативу.",
].join("\n");

function env(name: string, fallback = "") {
  return process.env[name] ?? fallback;
}

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getProviderConfig(): ProviderConfig {
  const provider = (env("LLM_PROVIDER") || env("AI_PROVIDER", "gemini")).toLowerCase();
  const isOpenRouter = provider === "openrouter";

  const baseUrl =
    env("LLM_BASE_URL") ||
    env("OPENROUTER_BASE_URL") ||
    env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");

  const apiKey =
    env("LLM_API_KEY") ||
    env("OPENROUTER_API_KEY") ||
    env("GEMINI_API_KEY");

  const model =
    env("LLM_MODEL") ||
    env("OPENROUTER_MODEL") ||
    env("AI_STANDARD_MODEL") ||
    env("GEMINI_MODEL", "gemini-2.5-flash-lite");

  const fallbackModels = (env("LLM_FALLBACK_MODELS") || env("OPENROUTER_FALLBACK_MODELS"))
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== model);

  return {
    provider,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey,
    model,
    fallbackModels: isOpenRouter ? fallbackModels : [],
    timeoutMs: intEnv("AI_TIMEOUT_SECONDS", 45) * 1000,
    maxTokens: intEnv("AI_MAX_OUTPUT_TOKENS", 700),
    reasoningEffort: env("GEMINI_REASONING_EFFORT"),
    title: env("OPENROUTER_TITLE", "DarkGPT Web"),
    referer: env("OPENROUTER_HTTP_REFERER"),
  };
}

function extractText(data: ChatCompletionResponse) {
  const choice = data.choices?.[0];
  const content = choice?.message?.content ?? choice?.text ?? "";
  if (content.trim()) {
    return content.trim();
  }
  const refusal = choice?.message?.refusal ?? "";
  return refusal.trim();
}

export async function createChatCompletion(userMessage: string) {
  const config = getProviderConfig();

  if (!config.apiKey) {
    throw new Error(`${config.provider} API key is not configured`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  const messages: ChatMessage[] = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: config.maxTokens,
    temperature: 0.7,
  };

  if (config.fallbackModels.length) {
    payload.models = [config.model, ...config.fallbackModels];
  } else {
    payload.model = config.model;
  }

  if (config.provider === "gemini" && config.reasoningEffort) {
    payload.reasoning_effort = config.reasoningEffort;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (config.provider === "openrouter") {
    headers["X-Title"] = config.title;
    if (config.referer) {
      headers["HTTP-Referer"] = config.referer;
    }
  }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const data = (await response.json()) as ChatCompletionResponse;
    if (!response.ok || data.error) {
      const error = typeof data.error === "string" ? data.error : data.error?.message;
      throw new Error(error || `LLM request failed with ${response.status}`);
    }

    const text = extractText(data);
    if (!text) {
      throw new Error("LLM returned empty response");
    }

    return {
      text,
      provider: config.provider,
      model: config.model,
    };
  } finally {
    clearTimeout(timeout);
  }
}
