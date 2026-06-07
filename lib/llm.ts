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
  provider: string;
  model: string;
};

type ProviderAttempt = ProviderConfig & {
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

function configForProvider(provider: string, tier: string, maxTokens: number): ProviderConfig {
  const normalizedProvider = provider.toLowerCase();
  const model = defaultModelForProvider(normalizedProvider, tier);
  const fallbackModels = fallbackModelsForProvider(normalizedProvider, tier, model);

  return {
    provider: normalizedProvider,
    baseUrl: openAiBaseUrlForProvider(normalizedProvider, env(`AI_${tier.toUpperCase()}_RUNPOD_ENDPOINT_ID`) || env("RUNPOD_ENDPOINT_ID")).replace(/\/+$/, ""),
    apiKey: apiKeyForProvider(normalizedProvider),
    model,
    fallbackModels,
    timeoutMs: intEnv("AI_TIMEOUT_SECONDS", 45) * 1000,
    maxTokens,
    reasoningEffort: env("GEMINI_REASONING_EFFORT"),
    title: env("OPENROUTER_TITLE", "DarkGPT Web"),
    referer: env("OPENROUTER_HTTP_REFERER"),
    tier,
    runpodEndpointId: env(`AI_${tier.toUpperCase()}_RUNPOD_ENDPOINT_ID`) || env("RUNPOD_ENDPOINT_ID"),
    replicateVersion: env(`AI_${tier.toUpperCase()}_REPLICATE_VERSION`) || env("REPLICATE_VERSION"),
  };
}

function defaultModelForProvider(provider: string, tier: string) {
  if (provider === "gemini") {
    const defaults: Record<string, string> = {
      lite: "gemini-2.5-flash-lite",
      standard: "gemini-2.5-flash",
      reasoning: "gemini-2.5-pro",
    };
    return env("GEMINI_MODEL", defaults[tier] || defaults.standard);
  }
  if (provider === "openrouter") {
    return env("OPENROUTER_MODEL") || env("LLM_MODEL", "openai/gpt-oss-120b:free");
  }
  if (provider === "runpod") {
    return env(`AI_${tier.toUpperCase()}_MODEL`) || env("RUNPOD_MODEL", tier);
  }
  if (provider === "replicate") {
    return env(`AI_${tier.toUpperCase()}_MODEL`) || env("REPLICATE_MODEL", tier);
  }
  return tier;
}

function fallbackModelsForProvider(provider: string, tier: string, model: string) {
  const configured =
    provider === "gemini"
      ? env(`AI_${tier.toUpperCase()}_FALLBACK_MODELS`) || env("GEMINI_FALLBACK_MODELS")
      : provider === "openrouter"
        ? env("OPENROUTER_FALLBACK_MODELS") || env("LLM_FALLBACK_MODELS")
        : "";

  const models = configured
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value && value !== model);

  if (models.length || provider !== "gemini") {
    return models;
  }

  return defaultFallbackModels(provider, tier, model);
}

function fallbackProvidersForConfig(config: ProviderConfig) {
  const configured = env(`AI_${config.tier.toUpperCase()}_FALLBACK_PROVIDERS`) || env("AI_FALLBACK_PROVIDERS");
  const providers = configured
    ? configured.split(",").map((value) => value.trim().toLowerCase())
    : config.provider === "gemini"
      ? ["openrouter"]
      : [];

  return providers.filter((provider, index) => provider && provider !== config.provider && providers.indexOf(provider) === index);
}

function attemptsForConfig(config: ProviderConfig): ProviderAttempt[] {
  const configs = [
    config,
    ...fallbackProvidersForConfig(config).map((provider) => configForProvider(provider, config.tier, config.maxTokens)),
  ];

  return configs.flatMap((providerConfig) => {
    const models = [providerConfig.model, ...providerConfig.fallbackModels.filter((model) => model !== providerConfig.model)];
    return models.map((model) => ({
      ...providerConfig,
      model,
    }));
  });
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
  return error instanceof LLMRequestError;
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

async function requestOpenAiCompatibleModel(attempt: ProviderAttempt, userMessage: string) {
  if (!attempt.apiKey) {
    throw new LLMRequestError(`${attempt.provider} API key is not configured`, 0, "provider_not_configured");
  }
  if (!attempt.baseUrl) {
    throw new LLMRequestError(`${attempt.provider} base URL is not configured`, 0, "provider_not_configured");
  }

  const messages: ChatMessage[] = [
    { role: "system", content: DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];

  const payload: Record<string, unknown> = {
    messages,
    max_tokens: attempt.maxTokens,
    temperature: 0.7,
  };

  payload.model = attempt.model;

  if (attempt.provider === "gemini" && attempt.reasoningEffort) {
    payload.reasoning_effort = attempt.reasoningEffort;
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${attempt.apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  if (attempt.provider === "openrouter") {
    headers["X-Title"] = attempt.title;
    if (attempt.referer) {
      headers["HTTP-Referer"] = attempt.referer;
    }
  }

  const { response, data } = await fetchJson(
    `${attempt.baseUrl}/chat/completions`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    },
    attempt.timeoutMs,
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
  const attempts = attemptsForConfig(config);
  let lastError: unknown = null;

  for (const attempt of attempts) {
    try {
      const text = await requestOpenAiCompatibleModel(attempt, userMessage);
      return { text, provider: attempt.provider, model: attempt.model };
    } catch (error) {
      if (error instanceof LLMRequestError && error.code === "provider_not_configured" && lastError) {
        continue;
      }
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
  return { text, provider: config.provider, model: config.model };
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
    provider: result.provider,
    model: result.model,
    tier: config.tier,
  };
}
