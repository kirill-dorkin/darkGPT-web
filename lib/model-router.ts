import { REQUEST_COST } from "@/lib/constants";

export const MODEL_TIERS = ["lite", "standard", "reasoning"] as const;
export const REMOTE_PROVIDERS = new Set(["gemini", "openrouter", "runpod", "replicate"]);

export type ModelTier = (typeof MODEL_TIERS)[number];

export type ModelProfile = {
  tier: ModelTier;
  provider: string;
  model: string;
  credits: number;
  maxTokens: number;
  runpodEndpointId: string;
  replicateVersion: string;
};

function env(name: string, fallback = "") {
  return process.env[name] ?? fallback;
}

function envForTier(prefix: string, tier: ModelTier, fallback = "") {
  const tierValue = process.env[`AI_${tier.toUpperCase()}_${prefix}`];
  if (tierValue !== undefined) {
    return tierValue;
  }
  if (prefix === "PROVIDER" || prefix === "MODEL") {
    const genericValue = process.env[`LLM_${prefix}`];
    if (genericValue !== undefined) {
      return genericValue;
    }
  }
  return fallback;
}

function intEnvForTier(prefix: string, tier: ModelTier, fallback: number) {
  const parsed = Number.parseInt(envForTier(prefix, tier, String(fallback)), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultModelForProvider(provider: string, tier: ModelTier) {
  if (provider === "gemini") {
    return env("GEMINI_MODEL", "gemini-2.5-flash-lite");
  }
  if (provider === "openrouter") {
    return env("OPENROUTER_MODEL") || env("LLM_MODEL", "openrouter/free");
  }
  return tier;
}

function normalizeTier(tier?: string | null): ModelTier {
  const selected = (tier || env("AI_DEFAULT_TIER", "standard")).toLowerCase();
  return MODEL_TIERS.includes(selected as ModelTier) ? (selected as ModelTier) : "standard";
}

export function getModelProfile(tier?: string | null): ModelProfile {
  const selectedTier = normalizeTier(tier);
  const llmProvider = process.env.LLM_PROVIDER;
  const defaultProvider = (llmProvider || env("AI_PROVIDER", "gemini")).toLowerCase();
  const tierProvider = envForTier("PROVIDER", selectedTier, "").toLowerCase();
  const provider = llmProvider
    ? defaultProvider
    : REMOTE_PROVIDERS.has(defaultProvider) && (tierProvider === "" || tierProvider === "demo")
      ? defaultProvider
      : tierProvider || defaultProvider;

  const model = llmProvider
    ? env("LLM_MODEL") || defaultModelForProvider(provider, selectedTier)
    : envForTier("MODEL", selectedTier, defaultModelForProvider(provider, selectedTier));

  return {
    tier: selectedTier,
    provider,
    model,
    credits: intEnvForTier("CREDITS", selectedTier, REQUEST_COST),
    maxTokens: intEnvForTier("MAX_OUTPUT_TOKENS", selectedTier, Number.parseInt(env("AI_MAX_OUTPUT_TOKENS", "700"), 10)),
    runpodEndpointId: envForTier("RUNPOD_ENDPOINT_ID", selectedTier, env("RUNPOD_ENDPOINT_ID")),
    replicateVersion: envForTier("REPLICATE_VERSION", selectedTier, env("REPLICATE_VERSION")),
  };
}

export function usesRemoteProvider(tier?: string | null) {
  return REMOTE_PROVIDERS.has(getModelProfile(tier).provider);
}
