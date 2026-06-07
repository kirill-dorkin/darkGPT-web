import { getModelProfile } from "@/lib/model-router";

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
  tier: string;
  runpodEndpointId: string;
  replicateVersion: string;
};

type CompletionResult = {
  text: string;
  model: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      refusal?: string | null;
    };
    text?: string;
  }>;
  output?: unknown;
  text?: string;
  response?: string;
  answer?: string;
  generated_text?: string;
  error?:
    | {
        message?: string;
        type?: string;
        code?: string | number;
      }
    | string;
  status?: string;
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

function openAiBaseUrlForProvider(provider: string, runpodEndpointId: string) {
  if (env("LLM_BASE_URL")) {
    return env("LLM_BASE_URL");
  }
  if (provider === "openrouter") {
    return env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1");
  }
  if (provider === "runpod") {
    return (
      env("RUNPOD_OPENAI_BASE_URL") ||
      (runpodEndpointId ? `https://api.runpod.ai/v2/${runpodEndpointId}/openai/v1` : "")
    );
  }
  return env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
}

function apiKeyForProvider(provider: string) {
  if (env("LLM_API_KEY")) {
    return env("LLM_API_KEY");
  }
  if (provider === "openrouter") {
    return env("OPENROUTER_API_KEY");
  }
  if (provider === "runpod") {
    return env("RUNPOD_API_KEY");
  }
  if (provider === "replicate") {
    return env("REPLICATE_API_TOKEN");
  }
  return env("GEMINI_API_KEY");
}

function getProviderConfig(tier?: string | null): ProviderConfig {
  const profile = getModelProfile(tier);
  const provider = profile.provider.toLowerCase();
  const configuredFallbackModels = (
    env(`AI_${profile.tier.toUpperCase()}_FALLBACK_MODELS`) ||
    env("GEMINI_FALLBACK_MODELS") ||
    env("LLM_FALLBACK_MODELS") ||
    env("OPENROUTER_FALLBACK_MODELS")
  )
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== profile.model);
  const fallbackModels = configuredFallbackModels.length
    ? configuredFallbackModels
    : defaultFallbackModels(provider, profile.tier, profile.model);

  return {
    provider,
    baseUrl: openAiBaseUrlForProvider(provider, profile.runpodEndpointId).replace(/\/+$/, ""),
    apiKey: apiKeyForProvider(provider),
    model: profile.model,
    fallbackModels,
    timeoutMs: intEnv("AI_TIMEOUT_SECONDS", 45) * 1000,
    maxTokens: profile.maxTokens,
    reasoningEffort: env("GEMINI_REASONING_EFFORT"),
    title: env("OPENROUTER_TITLE", "DarkGPT Web"),
    referer: env("OPENROUTER_HTTP_REFERER"),
    tier: profile.tier,
    runpodEndpointId: profile.runpodEndpointId,
    replicateVersion: profile.replicateVersion,
  };
}

function defaultFallbackModels(provider: string, tier: string, model: string) {
  if (provider !== "gemini") {
    return [];
  }

  const defaults: Record<string, string[]> = {
    lite: ["gemini-2.5-flash", "gemini-2.5-pro"],
    standard: ["gemini-2.5-flash-lite", "gemini-2.5-pro"],
    reasoning: ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  };

  return (defaults[tier] || defaults.standard).filter((fallbackModel) => fallbackModel !== model);
}

function extractText(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).join("").trim();
  }
  if (typeof value === "object") {
    const data = value as ChatCompletionResponse;
    for (const key of ["text", "response", "answer", "generated_text"] as const) {
      const text = extractText(data[key]);
      if (text) {
        return text;
      }
    }

    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? choice?.message?.refusal ?? choice?.text ?? "";
    if (content.trim()) {
      return content.trim();
    }

    return extractText(data.output);
  }
  return "";
}

function errorMessage(data: ChatCompletionResponse, fallback: string) {
  if (typeof data.error === "string") {
    return data.error;
  }
  return data.error?.message || fallback;
}

class LLMRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "provider_error") {
    super(message);
    this.name = "LLMRequestError";
    this.status = status;
    this.code = code;
  }
}

function isRetryableProviderError(error: unknown) {
  if (!(error instanceof LLMRequestError)) {
    return false;
  }
  return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
}

function demoResponse(userMessage: string) {
  return [
    "Demo answer for:",
    "",
    userMessage,
    "",
    "Configure AI_PROVIDER=gemini, AI_PROVIDER=openrouter, AI_PROVIDER=runpod, or AI_PROVIDER=replicate to use remote inference.",
  ].join("\n");
}

async function fetchJson(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse;
    return { response, data };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestOpenAiCompatibleModel(config: ProviderConfig, userMessage: string, model: string) {
  if (!config.apiKey) {
    throw new Error(`${config.provider} API key is not configured`);
  }
  if (!config.baseUrl) {
    throw new Error(`${config.provider} base URL is not configured`);
  }

  const messages: ChatMessage[] = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: config.maxTokens,
    temperature: 0.7,
  };

  payload.model = model;

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

  const { response, data } = await fetchJson(
    `${config.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    config.timeoutMs,
  );

  if (!response.ok || data.error) {
    throw new LLMRequestError(errorMessage(data, `LLM request failed with ${response.status}`), response.status);
  }

  const text = extractText(data);
  if (!text) {
    throw new LLMRequestError("LLM returned empty response", response.status, "empty_response");
  }
  return text;
}

async function createOpenAiCompatibleCompletion(config: ProviderConfig, userMessage: string): Promise<CompletionResult> {
  const models = [config.model, ...config.fallbackModels.filter((model) => model !== config.model)];
  let lastError: unknown = null;

  for (const model of models) {
    try {
      const text = await requestOpenAiCompatibleModel(config, userMessage, model);
      return { text, model };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error)) {
        throw error;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("LLM request failed");
}

async function createReplicateCompletion(config: ProviderConfig, userMessage: string): Promise<CompletionResult> {
  if (!config.apiKey || !config.replicateVersion) {
    throw new Error("Replicate is not configured");
  }

  const { response, data } = await fetchJson(
    "https://api.replicate.com/v1/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        Prefer: `wait=${Math.ceil(config.timeoutMs / 1000)}`,
        "Cancel-After": `${Math.ceil(config.timeoutMs / 1000)}s`,
      },
      body: JSON.stringify({
        version: config.replicateVersion,
        input: {
          prompt: `${DEFAULT_SYSTEM_PROMPT}\n\n${userMessage}`,
          max_new_tokens: config.maxTokens,
          model: config.model,
        },
      }),
    },
    config.timeoutMs + 5000,
  );

  if (!response.ok || data.error) {
    throw new Error(errorMessage(data, `Replicate request failed with ${response.status}`));
  }
  if (data.status && !["successful", "succeeded", "processing", "starting"].includes(data.status)) {
    throw new Error("Replicate request failed");
  }

  const text = extractText(data.output || data);
  if (!text) {
    throw new Error("Replicate returned empty response");
  }
  return { text, model: config.model };
}

export async function createChatCompletion(userMessage: string, tier?: string | null) {
  const config = getProviderConfig(tier);

  if (config.provider === "demo") {
    return {
      text: demoResponse(userMessage),
      provider: config.provider,
      model: config.model,
      tier: config.tier,
    };
  }

  const result =
    config.provider === "replicate"
      ? await createReplicateCompletion(config, userMessage)
      : await createOpenAiCompatibleCompletion(config, userMessage);

  return {
    text: result.text,
    provider: config.provider,
    model: result.model,
    tier: config.tier,
  };
}
