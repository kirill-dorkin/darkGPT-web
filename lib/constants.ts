export const FREE_REQUESTS_PER_DAY = 3;
export const REQUEST_COST = 12;
export const REFERRAL_BONUS = 50;
export const REFERRAL_PAYMENT_BONUS = 200;
export const MAX_REQUEST_LENGTH = 4000;
export const SUPPORTED_LANGUAGES = ["ru", "en"] as const;
export const DEFAULT_LANGUAGE = (process.env.DEFAULT_LANGUAGE === "en" ? "en" : "ru") as Language;
export const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || "@darkgpt_support";

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const PACKAGES = {
  package_10: { price: 10, credits: 1000 },
  package_25: { price: 25, credits: 2700 },
  package_50: { price: 50, credits: 5700 },
  package_100: { price: 100, credits: 12000 },
} as const;

export type PackageKey = keyof typeof PACKAGES;

export function isLanguage(value: unknown): value is Language {
  return value === "ru" || value === "en";
}

export function isPackageKey(value: unknown): value is PackageKey {
  return typeof value === "string" && value in PACKAGES;
}
