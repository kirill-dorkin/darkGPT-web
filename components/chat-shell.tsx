"use client";

import clsx from "clsx";
import {
  Bot,
  Check,
  Copy,
  CreditCard,
  HelpCircle,
  Languages,
  Loader2,
  Menu,
  MessageSquare,
  PanelLeft,
  RefreshCcw,
  RotateCcw,
  Send,
  Share2,
  User,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { locale, t } from "@/lib/locales";

type Language = "ru" | "en";
type Section = "chat" | "balance" | "referral" | "profile" | "language" | "help";
type ModelTier = "lite" | "standard" | "reasoning";

type PublicUser = {
  userId: string;
  username: string | null;
  language: Language | null;
  languageSelected: boolean;
  freeUsedToday: number;
  freeLeft: number;
  freeTotal: number;
  balance: number;
  totalPurchased: number;
  totalSpent: number;
  referralCount: number;
  paidReferralCount: number;
  referredBy: string | null;
};

type AppConfig = {
  freeTotal: number;
  requestCost: number;
  packages: Record<string, { price: number; credits: number }>;
  supportUsername: string;
  telegramBotUsername: string;
  telegramBotId: string;
  telegramClientId: string;
  modelTiers: Array<{
    tier: ModelTier;
    provider: string;
    model: string;
    credits: number;
    maxTokens: number;
  }>;
  origin?: string;
};

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  meta?: string;
};

type ApiEnvelope = {
  user?: PublicUser;
  config?: AppConfig;
  error?: string;
  code?: string;
  referralAwarded?: boolean;
  created?: boolean;
};

type ChatResponse = ApiEnvelope & {
  text?: string;
  provider?: string;
  model?: string;
  tier?: string;
  chargeType?: "free" | "credits";
  remaining?: number;
  cost?: number;
  balance?: number;
};

type InvoiceResponse = ApiEnvelope & {
  paymentId?: number;
  invoiceId?: string;
  invoiceUrl?: string;
  amountUsd?: number;
  credits?: number;
  status?: "pending" | "paid" | "expired";
  balance?: number;
};

type TelegramOidcResponse = ApiEnvelope & {
  telegram?: {
    id: string;
    username: string | null;
    name: string | null;
    picture: string | null;
    phoneNumber: string | null;
  };
};

type PaymentState = {
  packageKey: string;
  price: number;
  credits: number;
  paymentId?: number;
  invoiceUrl?: string;
  status: "confirm" | "creating" | "pending" | "paid" | "expired" | "error";
  message?: string;
};

type TelegramLoginAttempt = {
  at: number;
  userId: string;
  origin: string;
  botId: string;
  callbackUrl: string;
  status: "opened" | "callback_failed";
  errorCode?: string;
};

type TelegramDiagnostics = {
  ok: boolean;
  checkedAt: string;
  origin: string;
  callbackUrl: string;
  oauthUrl: string;
  bot: {
    id: string | null;
    username: string | null;
    clientId?: string | null;
  };
  checks: Array<{
    id: string;
    label: string;
    status: "ok" | "warning" | "error";
    detail: string;
  }>;
  summary: string;
};

type TelegramLoginPayload = {
  id_token?: string;
  user?: unknown;
  error?: string;
};

type TelegramLoginSdk = {
  Login?: {
    auth: (
      options: { client_id: number; request_access?: string[]; lang?: string },
      callback: (data: TelegramLoginPayload) => void,
    ) => void;
  };
};

declare global {
  interface Window {
    Telegram?: TelegramLoginSdk;
  }
}

const STORAGE_KEY = "darkgpt_web_user_id";
const TELEGRAM_ATTEMPT_KEY = "darkgpt_telegram_login_attempt";
const TELEGRAM_LOGIN_SCRIPT = "https://oauth.telegram.org/js/telegram-login.js?5";

const sectionIcons = {
  chat: MessageSquare,
  balance: Wallet,
  referral: Users,
  profile: User,
  language: Languages,
  help: HelpCircle,
} satisfies Record<Section, typeof MessageSquare>;

const quickPrompts = {
  ru: [
    "Объясни тему простыми словами.",
    "Напиши продающий текст.",
    "Помоги с кодом и покажи пример.",
    "Сделай чеклист запуска проекта.",
  ],
  en: [
    "Explain a topic in simple words.",
    "Write persuasive copy.",
    "Help with code and show an example.",
    "Make a launch checklist.",
  ],
} satisfies Record<Language, string[]>;

function nextId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatNumber(value: number, language: Language) {
  const formatted = Math.trunc(value || 0).toLocaleString("en-US");
  return language === "ru" ? formatted.replaceAll(",", " ") : formatted;
}

function cleanSupportUsername(value: string) {
  return value.replace(/^@/, "");
}

function makeInitialMessages(language: Language): ChatMessage[] {
  return [
    {
      id: "welcome",
      role: "assistant",
      content: t(language, "demoWelcome"),
      meta: t(language, "assistant"),
    },
  ];
}

async function postJson<T>(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
  if (!response.ok) {
    const error = new Error(data.error || "Request failed") as Error & { code?: string; data?: T };
    error.code = data.code;
    error.data = data;
    throw error;
  }
  return data;
}

function isValidUserId(value: string | null) {
  return Boolean(value && /^\d{4,18}$/.test(value));
}

function clearTelegramLoginQuery() {
  const url = new URL(window.location.href);
  for (const key of ["telegramLogin", "telegramUserId", "telegramError"]) {
    url.searchParams.delete(key);
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function readTelegramLoginAttempt() {
  try {
    const raw = window.localStorage.getItem(TELEGRAM_ATTEMPT_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<TelegramLoginAttempt>;
    if (!parsed || typeof parsed.at !== "number") {
      return null;
    }
    return {
      at: parsed.at,
      userId: typeof parsed.userId === "string" ? parsed.userId : "",
      origin: typeof parsed.origin === "string" ? parsed.origin : "",
      botId: typeof parsed.botId === "string" ? parsed.botId : "",
      callbackUrl: typeof parsed.callbackUrl === "string" ? parsed.callbackUrl : "",
      status: parsed.status === "callback_failed" ? "callback_failed" : "opened",
      errorCode: typeof parsed.errorCode === "string" ? parsed.errorCode : undefined,
    } satisfies TelegramLoginAttempt;
  } catch {
    return null;
  }
}

function writeTelegramLoginAttempt(attempt: TelegramLoginAttempt) {
  window.localStorage.setItem(TELEGRAM_ATTEMPT_KEY, JSON.stringify(attempt));
}

function clearTelegramLoginAttempt() {
  window.localStorage.removeItem(TELEGRAM_ATTEMPT_KEY);
}

function telegramErrorReason(language: Language, code?: string) {
  const loc = locale(language);
  if (code === "telegram_payload_invalid") {
    return loc.telegramErrorPayload;
  }
  if (code === "telegram_auth_failed") {
    return loc.telegramErrorHash;
  }
  if (code === "telegram_login_failed") {
    return loc.telegramErrorStorage;
  }
  return loc.telegramErrorUnknown;
}

function loadTelegramLoginScript() {
  return new Promise<void>((resolve, reject) => {
    if (window.Telegram?.Login?.auth) {
      resolve();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TELEGRAM_LOGIN_SCRIPT}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Telegram Login script failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TELEGRAM_LOGIN_SCRIPT;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Telegram Login script failed to load"));
    document.head.appendChild(script);
  });
}

export default function ChatShell() {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [activeSection, setActiveSection] = useState<Section>("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(makeInitialMessages("ru"));
  const [input, setInput] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState("");
  const [payment, setPayment] = useState<PaymentState | null>(null);
  const [selectedTier, setSelectedTier] = useState<ModelTier>("standard");
  const [telegramAttempt, setTelegramAttempt] = useState<TelegramLoginAttempt | null>(null);
  const [telegramDiagnostics, setTelegramDiagnostics] = useState<TelegramDiagnostics | null>(null);
  const [isCheckingTelegram, setIsCheckingTelegram] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const language: Language = user?.language || "ru";
  const loc = locale(language);
  const canSend = input.trim().length > 0 && !isLoading && Boolean(user?.languageSelected);
  const origin = config?.origin || (typeof window !== "undefined" ? window.location.origin : "");
  const referralLink = user ? `${origin}?ref=${user.userId}` : "";
  const supportUrl = user
    ? `https://t.me/${cleanSupportUsername(config?.supportUsername || "@darkgpt_support")}?text=${encodeURIComponent(
        `${loc.userId}: ${user.userId}. `,
      )}`
    : "";

  const applyEnvelope = useCallback((data: ApiEnvelope) => {
    if (data.user) {
      setUser(data.user);
      if (data.user.language) {
        setMessages((current) => (current.length ? current : makeInitialMessages(data.user?.language || "ru")));
      }
    }
    if (data.config) {
      setConfig(data.config);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      const params = new URLSearchParams(window.location.search);
      const referralId = params.get("ref") || params.get("start") || "";
      const telegramLogin = params.get("telegramLogin");
      const telegramUserId = params.get("telegramUserId");
      const telegramError = params.get("telegramError") || "";
      const returnedUserId = isValidUserId(telegramUserId) ? telegramUserId : "";
      const storedUserId = returnedUserId || window.localStorage.getItem(STORAGE_KEY);
      const existingTelegramAttempt = readTelegramLoginAttempt();
      setTelegramAttempt(existingTelegramAttempt);

      try {
        const data = await postJson<ApiEnvelope>("/api/session", {
          userId: storedUserId,
          referralId,
        });
        if (cancelled) {
          return;
        }
        applyEnvelope(data);
        if (data.user?.userId) {
          window.localStorage.setItem(STORAGE_KEY, data.user.userId);
        }
        if (data.user?.language) {
          setMessages(makeInitialMessages(data.user.language));
        }
        if (telegramLogin === "success") {
          clearTelegramLoginAttempt();
          setTelegramAttempt(null);
          setNotice(t(data.user?.language || "ru", "telegramLoggedIn"));
          setActiveSection(data.user?.languageSelected ? "profile" : "language");
          clearTelegramLoginQuery();
        } else if (telegramLogin === "failed") {
          const nextLanguage = data.user?.language || "ru";
          const failedAttempt: TelegramLoginAttempt = {
            at: existingTelegramAttempt?.at || Date.now(),
            userId: existingTelegramAttempt?.userId || storedUserId || "",
            origin: existingTelegramAttempt?.origin || data.config?.origin || window.location.origin,
            botId: existingTelegramAttempt?.botId || data.config?.telegramBotId || "",
            callbackUrl: existingTelegramAttempt?.callbackUrl || "",
            status: "callback_failed",
            errorCode: telegramError || "telegram_unknown",
          };
          writeTelegramLoginAttempt(failedAttempt);
          setTelegramAttempt(failedAttempt);
          setNotice(`${t(nextLanguage, "telegramAuthFailed")} ${telegramErrorReason(nextLanguage, telegramError)}`);
          clearTelegramLoginQuery();
        }
      } catch (error) {
        if (!cancelled) {
          setNotice(error instanceof Error ? error.message : "Could not create session");
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [applyEnvelope]);

  useEffect(() => {
    void loadTelegramLoginScript().catch(() => undefined);
  }, []);

  const updateUserFromEnvelope = useCallback((data: ApiEnvelope) => {
    applyEnvelope(data);
    if (data.user?.userId) {
      window.localStorage.setItem(STORAGE_KEY, data.user.userId);
    }
  }, [applyEnvelope]);

  async function selectLanguage(nextLanguage: Language) {
    if (!user) {
      return;
    }
    setIsLoading(true);
    setNotice("");
    try {
      const data = await postJson<ApiEnvelope>("/api/language", {
        userId: user.userId,
        language: nextLanguage,
      });
      updateUserFromEnvelope(data);
      setMessages(makeInitialMessages(nextLanguage));
      setNotice(data.referralAwarded ? t(nextLanguage, "joinedByReferral") : t(nextLanguage, "languageChanged"));
      setActiveSection("chat");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(nextLanguage, "errorGeneric"));
    } finally {
      setIsLoading(false);
    }
  }

  async function sendMessage(messageText = input) {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading || !user?.languageSelected) {
      return;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      meta: loc.you,
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setNotice("");
    setIsLoading(true);

    try {
      const data = await postJson<ChatResponse>("/api/chat", {
        userId: user.userId,
        message: trimmed,
        tier: selectedTier,
      });
      updateUserFromEnvelope(data);

      const statusText =
        data.chargeType === "credits"
          ? t(language, "chatStatusCredits", {
              cost: formatNumber(data.cost || 0, language),
              balance: formatNumber(data.user?.balance ?? data.balance ?? 0, language),
            })
          : t(language, "chatStatusFree", {
              free: formatNumber(data.user?.freeLeft ?? data.remaining ?? 0, language),
              balance: formatNumber(data.user?.balance ?? data.balance ?? 0, language),
            });

      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          content: data.text || "",
          meta: [data.provider, data.model].filter(Boolean).join(" / ") || loc.assistant,
        },
        {
          id: nextId(),
          role: "assistant",
          content: statusText,
          meta: "Status",
        },
      ]);
    } catch (requestError) {
      const error = requestError as Error & { code?: string; data?: ChatResponse };
      if (error.data) {
        updateUserFromEnvelope(error.data);
      }
      const message =
        error.code === "limit_reached"
          ? t(language, "limitReached", {
              free_used: user.freeTotal,
              free_total: user.freeTotal,
            })
          : error.code === "not_enough_credits"
            ? t(language, "notEnoughCredits")
            : error.code === "request_too_long"
              ? t(language, "requestTooLong")
              : error.code === "ai_unavailable"
                ? t(language, "aiUnavailable")
                : error.message || t(language, "errorGeneric");
      setNotice(message);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          content: message,
          meta: "Error",
        },
      ]);
      if (error.code === "limit_reached" || error.code === "not_enough_credits") {
        setActiveSection("balance");
      }
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage();
  }

  function resetChat() {
    setMessages(makeInitialMessages(language));
    setNotice("");
    setInput("");
  }

  function handleTelegramAttempt(attempt: TelegramLoginAttempt) {
    writeTelegramLoginAttempt(attempt);
    setTelegramAttempt(attempt);
    setTelegramDiagnostics(null);
  }

  async function checkTelegramDiagnostics() {
    setIsCheckingTelegram(true);
    setNotice("");
    try {
      const params = new URLSearchParams({ language });
      if (user?.userId) {
        params.set("currentUserId", user.userId);
      }
      const response = await fetch(`/api/auth/telegram/diagnostics?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as Partial<TelegramDiagnostics> & { error?: string };
      if (!response.ok || !data.checks) {
        throw new Error(data.error || loc.telegramDiagnosticsUnavailable);
      }
      setTelegramDiagnostics(data as TelegramDiagnostics);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : loc.telegramDiagnosticsUnavailable);
    } finally {
      setIsCheckingTelegram(false);
    }
  }

  async function handleTelegramOidcAuth(data: TelegramLoginPayload, currentUserId: string) {
    if (data.error) {
      setNotice(`${loc.telegramAuthFailed} ${data.error}`);
      return;
    }
    if (!data.id_token) {
      setNotice(`${loc.telegramAuthFailed} ${loc.telegramErrorPayload}`);
      return;
    }

    setIsLoading(true);
    setNotice("");
    try {
      const response = await postJson<TelegramOidcResponse>("/api/auth/telegram/oidc", {
        idToken: data.id_token,
        currentUserId,
      });
      updateUserFromEnvelope(response);
      if (response.user?.userId) {
        window.localStorage.setItem(STORAGE_KEY, response.user.userId);
      }
      clearTelegramLoginAttempt();
      setTelegramAttempt(null);
      const nextLanguage = response.user?.language || language;
      setNotice(t(nextLanguage, "telegramLoggedIn"));
      setActiveSection(response.user?.languageSelected ? "profile" : "language");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : loc.telegramAuthFailed);
    } finally {
      setIsLoading(false);
    }
  }

  async function copyText(text: string, label: string) {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1200);
  }

  function beginPayment(packageKey: string, price: number, credits: number) {
    setPayment({ packageKey, price, credits, status: "confirm" });
    setNotice("");
  }

  async function createPaymentInvoice() {
    if (!user || !payment) {
      return;
    }

    setPayment({ ...payment, status: "creating" });
    try {
      const data = await postJson<InvoiceResponse>("/api/payments/create", {
        userId: user.userId,
        packageKey: payment.packageKey,
      });
      updateUserFromEnvelope(data);
      setPayment({
        ...payment,
        paymentId: data.paymentId,
        invoiceUrl: data.invoiceUrl,
        status: "pending",
        message: t(language, "invoiceCreated", {
          price: formatNumber(payment.price, language),
          credits: formatNumber(payment.credits, language),
        }),
      });
    } catch (error) {
      setPayment({
        ...payment,
        status: "error",
        message: error instanceof Error ? error.message : t(language, "paymentCreateError"),
      });
    }
  }

  async function checkPayment() {
    if (!user || !payment?.paymentId) {
      return;
    }

    setIsLoading(true);
    try {
      const data = await postJson<InvoiceResponse>("/api/payments/check", {
        userId: user.userId,
        paymentId: payment.paymentId,
      });
      updateUserFromEnvelope(data);
      if (data.status === "paid") {
        setPayment({
          ...payment,
          status: "paid",
          message: t(language, "paymentSuccess", {
            credits: formatNumber(data.credits || payment.credits, language),
            balance: formatNumber(data.user?.balance || data.balance || 0, language),
          }),
        });
      } else if (data.status === "expired") {
        setPayment({ ...payment, status: "expired", message: t(language, "paymentExpired") });
      } else {
        setPayment({ ...payment, status: "pending", message: t(language, "paymentPending") });
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t(language, "errorGeneric"));
    } finally {
      setIsLoading(false);
    }
  }

  if (isBooting) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <div className="flex items-center gap-3 rounded-lg border border-line bg-white px-4 py-3 shadow-soft">
          <Loader2 className="animate-spin text-signal" size={20} />
          <span className="text-sm font-medium">DarkGPT</span>
        </div>
      </main>
    );
  }

  if (!user?.languageSelected) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4 text-ink">
        <section className="w-full max-w-md rounded-lg border border-line bg-white p-6 shadow-soft">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-md bg-ink text-white">
              <Bot size={23} />
            </div>
            <div>
              <h1 className="text-xl font-semibold">DarkGPT</h1>
              <p className="whitespace-pre-line text-sm text-slate-600">{loc.languageFirstRun}</p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void selectLanguage("ru")}
              disabled={isLoading}
              className="flex h-12 items-center justify-center rounded-md border border-line bg-panel text-sm font-semibold transition hover:border-signal hover:bg-white disabled:opacity-60"
            >
              Русский
            </button>
            <button
              type="button"
              onClick={() => void selectLanguage("en")}
              disabled={isLoading}
              className="flex h-12 items-center justify-center rounded-md border border-line bg-panel text-sm font-semibold transition hover:border-signal hover:bg-white disabled:opacity-60"
            >
              English
            </button>
          </div>
          <div className="mt-5 border-t border-line pt-5">
            <p className="mb-3 text-sm text-slate-600">{loc.telegramLoginHint}</p>
            <TelegramLoginButton
              clientId={config?.telegramClientId || config?.telegramBotId || ""}
              currentUserId={user?.userId || ""}
              language={language}
              onAttempt={handleTelegramAttempt}
              onAuth={(data, currentUserId) => void handleTelegramOidcAuth(data, currentUserId)}
            />
            <TelegramDiagnosticsPanel
              language={language}
              attempt={telegramAttempt}
              diagnostics={telegramDiagnostics}
              isChecking={isCheckingTelegram}
              onCheck={() => void checkTelegramDiagnostics()}
            />
          </div>
          {notice ? <div className="mt-4 rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800">{notice}</div> : null}
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-3 py-3 text-ink sm:px-5 lg:px-7">
      <div className="mx-auto grid min-h-[calc(100vh-24px)] max-w-7xl grid-cols-1 overflow-hidden rounded-lg border border-line bg-white shadow-soft lg:grid-cols-[304px_minmax(0,1fr)]">
        <aside
          className={clsx(
            "border-b border-line bg-panel lg:border-b-0 lg:border-r",
            sidebarOpen ? "block" : "hidden lg:block",
          )}
        >
          <div className="flex h-full flex-col">
            <div className="border-b border-line p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white">
                    <Bot size={22} />
                  </div>
                  <div>
                    <h1 className="text-lg font-semibold leading-tight">DarkGPT</h1>
                    <p className="text-sm text-slate-600">Web</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-ink lg:hidden"
                  title="Close"
                >
                  <X size={17} />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 border-b border-line p-4 text-sm">
              <Metric label={loc.freeToday} value={`${formatNumber(user.freeLeft, language)}/${user.freeTotal}`} />
              <Metric label={loc.currentBalance} value={formatNumber(user.balance, language)} icon={<Zap size={14} />} />
            </div>

            <nav className="space-y-1 p-3">
              {(["chat", "balance", "referral", "profile", "language", "help"] as Section[]).map((section) => {
                const Icon = sectionIcons[section];
                const label = loc[`nav${section[0].toUpperCase()}${section.slice(1)}` as keyof typeof loc] || section;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => {
                      setActiveSection(section);
                      setSidebarOpen(false);
                    }}
                    className={clsx(
                      "flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition",
                      activeSection === section
                        ? "bg-ink text-white"
                        : "text-slate-700 hover:bg-white hover:text-ink",
                    )}
                  >
                    <Icon size={17} />
                    {label}
                  </button>
                );
              })}
            </nav>

            <div className="mt-auto border-t border-line p-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Metric label={loc.requests} value={String(messages.filter((message) => message.role === "user").length)} />
                <Metric label={loc.mode} value={loc.live} icon={<Check size={14} />} />
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-24px)] min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((value) => !value)}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-signal hover:text-ink"
                title="Menu"
              >
                <PanelLeft size={18} className="hidden lg:block" />
                <Menu size={18} className="lg:hidden" />
              </button>
              <div className="min-w-0">
                <div className="text-sm text-slate-500">{sectionTitle(activeSection, loc)}</div>
                <div className="truncate font-semibold">{activeSection === "chat" ? loc.newSession : "DarkGPT"}</div>
              </div>
            </div>
            {activeSection === "chat" ? (
              <button
                type="button"
                onClick={resetChat}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-slate-700 transition hover:border-warning hover:text-warning"
              >
                <RotateCcw size={16} />
                <span className="hidden sm:inline">{loc.reset}</span>
              </button>
            ) : null}
          </header>

          {notice ? (
            <div className="border-b border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800 sm:px-5">
              {notice}
            </div>
          ) : null}
          {copied ? (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 sm:px-5">
              {copied}
            </div>
          ) : null}

          {activeSection === "chat" ? (
            <ChatView
              messages={messages}
              input={input}
              isLoading={isLoading}
              language={language}
              canSend={canSend}
              textareaRef={textareaRef}
              onInput={setInput}
              onSubmit={handleSubmit}
              onSend={sendMessage}
              onCopy={copyText}
              selectedTier={selectedTier}
              modelTiers={config?.modelTiers || []}
              onTierChange={setSelectedTier}
            />
          ) : null}

          {activeSection === "balance" ? (
            <BalanceView
              user={user}
              config={config}
              language={language}
              payment={payment}
              isLoading={isLoading}
              onBeginPayment={beginPayment}
              onCreateInvoice={createPaymentInvoice}
              onCheckPayment={checkPayment}
              onCancelPayment={() => setPayment(null)}
              onChat={() => setActiveSection("chat")}
            />
          ) : null}

          {activeSection === "referral" ? (
            <ReferralView
              user={user}
              language={language}
              referralLink={referralLink}
              onCopy={copyText}
            />
          ) : null}

          {activeSection === "profile" ? (
            <ProfileView
              user={user}
              language={language}
              telegramClientId={config?.telegramClientId || config?.telegramBotId || ""}
              telegramAttempt={telegramAttempt}
              telegramDiagnostics={telegramDiagnostics}
              isCheckingTelegram={isCheckingTelegram}
              onTelegramAttempt={handleTelegramAttempt}
              onCheckTelegram={() => void checkTelegramDiagnostics()}
              onTelegramAuth={(data, currentUserId) => void handleTelegramOidcAuth(data, currentUserId)}
            />
          ) : null}

          {activeSection === "language" ? (
            <LanguageView language={language} isLoading={isLoading} onSelect={selectLanguage} />
          ) : null}

          {activeSection === "help" ? (
            <HelpView user={user} language={language} supportUrl={supportUrl} supportUsername={config?.supportUsername || "@darkgpt_support"} />
          ) : null}
        </section>
      </div>
    </main>
  );
}

function sectionTitle(section: Section, loc: ReturnType<typeof locale>) {
  const titles: Record<Section, string> = {
    chat: loc.chatTitle,
    balance: loc.balanceTitle,
    referral: loc.referralTitle,
    profile: loc.profileTitle,
    language: loc.languageTitle,
    help: loc.helpTitle,
  };
  return titles[section];
}

function Metric({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="text-xs leading-snug text-slate-500">{label}</div>
      <div className="mt-1 flex items-center gap-1 truncate text-lg font-semibold">
        {icon}
        {value}
      </div>
    </div>
  );
}

function TelegramLoginButton({
  clientId,
  currentUserId,
  language,
  onAttempt,
  onAuth,
}: {
  clientId: string;
  currentUserId: string;
  language: Language;
  onAttempt: (attempt: TelegramLoginAttempt) => void;
  onAuth: (data: TelegramLoginPayload, currentUserId: string) => void;
}) {
  const loc = locale(language);
  if (!clientId || !/^\d+$/.test(clientId)) {
    return (
      <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
        {loc.telegramUnavailable}
      </div>
    );
  }

  async function openTelegramLogin() {
    onAttempt({
      at: Date.now(),
      userId: currentUserId,
      origin: window.location.origin,
      botId: clientId,
      callbackUrl: "/api/auth/telegram/oidc",
      status: "opened",
    });

    try {
      await loadTelegramLoginScript();
      window.Telegram?.Login?.auth(
        {
          client_id: Number(clientId),
          request_access: ["write"],
          lang: language,
        },
        (data) => onAuth(data, currentUserId),
      );
    } catch (error) {
      onAuth({ error: error instanceof Error ? error.message : "Telegram Login script failed to load" }, currentUserId);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void openTelegramLogin()}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
    >
      <Send size={17} />
      {loc.telegramLogin}
    </button>
  );
}

function TelegramDiagnosticsPanel({
  language,
  attempt,
  diagnostics,
  isChecking,
  onCheck,
}: {
  language: Language;
  attempt: TelegramLoginAttempt | null;
  diagnostics: TelegramDiagnostics | null;
  isChecking: boolean;
  onCheck: () => void;
}) {
  const loc = locale(language);
  const attemptTime = attempt ? new Date(attempt.at).toLocaleString(language === "ru" ? "ru-RU" : "en-US") : "";
  const attemptMessage =
    attempt?.status === "callback_failed"
      ? t(language, "telegramCallbackFailed", { reason: telegramErrorReason(language, attempt.errorCode) })
      : loc.telegramCallbackWaiting;

  return (
    <div className="mt-3 rounded-md border border-line bg-panel p-3 text-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="font-semibold text-slate-800">{loc.telegramDiagnostics}</div>
        <button
          type="button"
          onClick={onCheck}
          disabled={isChecking}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-semibold text-slate-800 transition hover:border-signal disabled:opacity-60"
        >
          {isChecking ? <Loader2 size={15} className="animate-spin" /> : <RefreshCcw size={15} />}
          {isChecking ? loc.telegramChecking : loc.telegramCheck}
        </button>
      </div>

      <div
        className={clsx(
          "mt-3 rounded-md border px-3 py-2",
          attempt?.status === "callback_failed"
            ? "border-red-200 bg-red-50 text-red-800"
            : attempt
              ? "border-orange-200 bg-orange-50 text-orange-800"
              : "border-line bg-white text-slate-600",
        )}
      >
        <div className="font-medium">{attempt ? `${loc.telegramLastAttempt}: ${attemptTime}` : loc.telegramNoAttempt}</div>
        {attempt ? <div className="mt-1 leading-relaxed">{attemptMessage}</div> : null}
      </div>

      {diagnostics ? (
        <div className="mt-3 space-y-2">
          <div
            className={clsx(
              "rounded-md border px-3 py-2 font-medium",
              diagnostics.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {diagnostics.ok ? loc.telegramDiagnosticsOk : loc.telegramDiagnosticsProblem}
          </div>
          {diagnostics.checks.map((item) => (
            <div key={item.id} className="flex gap-2 rounded-md border border-line bg-white px-3 py-2">
              <div
                className={clsx(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                  item.status === "ok"
                    ? "bg-emerald-100 text-emerald-700"
                    : item.status === "warning"
                      ? "bg-orange-100 text-orange-700"
                      : "bg-red-100 text-red-700",
                )}
              >
                {item.status === "ok" ? <Check size={13} /> : <X size={13} />}
              </div>
              <div className="min-w-0">
                <div className="font-medium text-slate-800">{item.label}</div>
                <div className="mt-0.5 break-words text-slate-600">{item.detail}</div>
              </div>
            </div>
          ))}
          <div className="rounded-md border border-line bg-white px-3 py-2 text-slate-700">{diagnostics.summary}</div>
        </div>
      ) : null}
    </div>
  );
}

function ChatView({
  messages,
  input,
  isLoading,
  language,
  canSend,
  textareaRef,
  onInput,
  onSubmit,
  onSend,
  onCopy,
  selectedTier,
  modelTiers,
  onTierChange,
}: {
  messages: ChatMessage[];
  input: string;
  isLoading: boolean;
  language: Language;
  canSend: boolean;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  onInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onSend: (value?: string) => Promise<void>;
  onCopy: (text: string, label: string) => Promise<void>;
  selectedTier: ModelTier;
  modelTiers: AppConfig["modelTiers"];
  onTierChange: (tier: ModelTier) => void;
}) {
  const loc = locale(language);
  return (
    <>
      <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {quickPrompts[language].map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => void onSend(prompt)}
                disabled={isLoading}
                className="rounded-md border border-line bg-panel px-3 py-2 text-left text-sm text-slate-700 transition hover:border-signal hover:bg-white hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
              >
                {prompt}
              </button>
            ))}
          </div>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} language={language} onCopy={onCopy} />
          ))}
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-4 py-3 text-sm text-slate-600">
              <Loader2 size={17} className="animate-spin" />
              {loc.generating}
            </div>
          ) : null}
        </div>
      </div>

      <form onSubmit={onSubmit} className="border-t border-line bg-panel p-3 sm:p-4">
        {modelTiers.length ? (
          <div className="mx-auto mb-2 flex max-w-4xl gap-2 overflow-x-auto">
            {modelTiers.map((tier) => (
              <button
                key={tier.tier}
                type="button"
                onClick={() => onTierChange(tier.tier)}
                className={clsx(
                  "shrink-0 rounded-md border px-3 py-2 text-left text-xs transition",
                  selectedTier === tier.tier
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-slate-700 hover:border-signal",
                )}
                title={`${tier.provider} / ${tier.model}`}
              >
                <span className="block font-semibold capitalize">{tier.tier}</span>
                <span className="block max-w-44 truncate opacity-80">{tier.model}</span>
              </button>
            ))}
          </div>
        ) : null}
        <div className="mx-auto flex max-w-4xl gap-2 rounded-lg border border-line bg-white p-2 shadow-sm">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => onInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void onSend();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder={loc.placeholder}
            className="max-h-40 min-h-[48px] flex-1 resize-none rounded-md border-0 px-3 py-2 text-sm outline-none placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ink text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            title={loc.send}
          >
            {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={19} />}
          </button>
        </div>
        <div className="mx-auto mt-2 flex max-w-4xl justify-end text-xs text-slate-500">
          <span>{input.length}/4000</span>
        </div>
      </form>
    </>
  );
}

function MessageBubble({
  message,
  language,
  onCopy,
}: {
  message: ChatMessage;
  language: Language;
  onCopy: (text: string, label: string) => Promise<void>;
}) {
  const loc = locale(language);
  const isUser = message.role === "user";

  return (
    <article className={clsx("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white">
          <Bot size={18} />
        </div>
      ) : null}

      <div
        className={clsx(
          "min-w-0 max-w-[88%] rounded-lg border px-4 py-3",
          isUser ? "border-signal bg-blue-50" : "border-line bg-panel",
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold uppercase text-slate-500">
            {isUser ? <User size={13} /> : <Bot size={13} />}
            <span className="truncate">{message.meta || (isUser ? loc.you : loc.assistant)}</span>
          </div>
          <button
            type="button"
            onClick={() => void onCopy(message.content, loc.copied)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-ink"
            title={loc.copy}
          >
            <Copy size={14} />
          </button>
        </div>
        <div className="markdown-body text-sm text-slate-900">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
      </div>

      {isUser ? (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-signal text-white">
          <User size={18} />
        </div>
      ) : null}
    </article>
  );
}

function BalanceView({
  user,
  config,
  language,
  payment,
  isLoading,
  onBeginPayment,
  onCreateInvoice,
  onCheckPayment,
  onCancelPayment,
  onChat,
}: {
  user: PublicUser;
  config: AppConfig | null;
  language: Language;
  payment: PaymentState | null;
  isLoading: boolean;
  onBeginPayment: (packageKey: string, price: number, credits: number) => void;
  onCreateInvoice: () => Promise<void>;
  onCheckPayment: () => Promise<void>;
  onCancelPayment: () => void;
  onChat: () => void;
}) {
  const loc = locale(language);
  const packages = config?.packages || {};

  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label={loc.currentBalance} value={`${formatNumber(user.balance, language)} ${loc.credits}`} icon={<Wallet size={18} />} />
          <Stat label={loc.freeToday} value={`${formatNumber(user.freeLeft, language)}/${user.freeTotal}`} icon={<Zap size={18} />} />
          <Stat label={loc.requestCost} value={`${formatNumber(config?.requestCost || 12, language)} ${loc.credits}`} icon={<CreditCard size={18} />} />
        </div>

        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">{loc.balanceTitle}</h2>
            <p className="mt-1 text-sm text-slate-600">{loc.balanceScreen}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {Object.entries(packages).map(([packageKey, pack]) => (
              <button
                key={packageKey}
                type="button"
                onClick={() => onBeginPayment(packageKey, pack.price, pack.credits)}
                className="flex items-center justify-between rounded-md border border-line bg-panel p-4 text-left transition hover:border-signal hover:bg-white"
              >
                <span className="font-semibold">
                  ${formatNumber(pack.price, language)}
                  {" -> "}
                  {formatNumber(pack.credits, language)} {loc.credits}
                </span>
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-ink text-white">
                  <Wallet size={17} />
                </span>
              </button>
            ))}
          </div>
        </section>

        {payment ? (
          <section className="rounded-lg border border-line bg-panel p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">{loc.topUp}</h3>
                <p className="mt-1 whitespace-pre-line text-sm text-slate-700">
                  {payment.message ||
                    t(language, "topupConfirm", {
                      price: formatNumber(payment.price, language),
                      credits: formatNumber(payment.credits, language),
                    })}
                </p>
              </div>
              <button
                type="button"
                onClick={onCancelPayment}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-ink"
                title={loc.back}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {payment.status === "confirm" || payment.status === "error" ? (
                <button
                  type="button"
                  onClick={() => void onCreateInvoice()}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <CreditCard size={16} />
                  {loc.createInvoice}
                </button>
              ) : null}
              {payment.status === "creating" ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-300 px-4 text-sm font-semibold text-white"
                >
                  <Loader2 size={16} className="animate-spin" />
                  {loc.createInvoice}
                </button>
              ) : null}
              {payment.invoiceUrl && payment.status !== "paid" && payment.status !== "expired" ? (
                <a
                  href={payment.invoiceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-signal"
                >
                  <CreditCard size={16} />
                  {loc.payCrypto}
                </a>
              ) : null}
              {payment.paymentId && payment.status !== "paid" && payment.status !== "expired" ? (
                <button
                  type="button"
                  onClick={() => void onCheckPayment()}
                  disabled={isLoading}
                  className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-signal disabled:opacity-60"
                >
                  {isLoading ? <Loader2 size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
                  {loc.checkPayment}
                </button>
              ) : null}
              {payment.status === "paid" ? (
                <button
                  type="button"
                  onClick={onChat}
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
                >
                  <MessageSquare size={16} />
                  {loc.goToChat}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function ReferralView({
  user,
  language,
  referralLink,
  onCopy,
}: {
  user: PublicUser;
  language: Language;
  referralLink: string;
  onCopy: (text: string, label: string) => Promise<void>;
}) {
  const loc = locale(language);
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(
    language === "ru" ? "Попробуй DarkGPT" : "Try DarkGPT",
  )}`;

  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{loc.referralTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{loc.referralText}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Stat label={loc.invited} value={formatNumber(user.referralCount, language)} icon={<Users size={18} />} />
          <Stat label={loc.paidReferrals} value={formatNumber(user.paidReferralCount, language)} icon={<CreditCard size={18} />} />
        </div>
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-2 text-sm font-semibold text-slate-700">{loc.referralLink}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-md border border-line bg-white px-3 py-2 text-sm">
              {referralLink}
            </code>
            <button
              type="button"
              onClick={() => void onCopy(referralLink, loc.copied)}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-white px-4 text-sm font-semibold text-slate-800 transition hover:border-signal"
            >
              <Copy size={16} />
              {loc.copy}
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Share2 size={16} />
              {loc.share}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProfileView({
  user,
  language,
  telegramClientId,
  telegramAttempt,
  telegramDiagnostics,
  isCheckingTelegram,
  onTelegramAttempt,
  onCheckTelegram,
  onTelegramAuth,
}: {
  user: PublicUser;
  language: Language;
  telegramClientId: string;
  telegramAttempt: TelegramLoginAttempt | null;
  telegramDiagnostics: TelegramDiagnostics | null;
  isCheckingTelegram: boolean;
  onTelegramAttempt: (attempt: TelegramLoginAttempt) => void;
  onCheckTelegram: () => void;
  onTelegramAuth: (data: TelegramLoginPayload, currentUserId: string) => void;
}) {
  const loc = locale(language);
  const langName = language === "ru" ? loc.russian : loc.english;
  const telegramName = user.username && user.username !== "web" ? `@${user.username.replace(/^@/, "")}` : loc.telegramUnavailable;
  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <h2 className="text-lg font-semibold">{loc.profileTitle}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label={loc.userId} value={user.userId} icon={<User size={18} />} />
          <Stat label={loc.account} value={telegramName} icon={<Bot size={18} />} />
          <Stat label={loc.interfaceLanguage} value={langName} icon={<Languages size={18} />} />
          <Stat label={loc.currentBalance} value={`${formatNumber(user.balance, language)} ${loc.credits}`} icon={<Wallet size={18} />} />
          <Stat label={loc.freeToday} value={`${formatNumber(user.freeLeft, language)}/${user.freeTotal}`} icon={<Zap size={18} />} />
          <Stat label={loc.invited} value={formatNumber(user.referralCount, language)} icon={<Users size={18} />} />
          <Stat label={loc.paidReferrals} value={formatNumber(user.paidReferralCount, language)} icon={<CreditCard size={18} />} />
          <Stat label={loc.totalPurchased} value={formatNumber(user.totalPurchased, language)} icon={<Wallet size={18} />} />
          <Stat label={loc.totalSpent} value={formatNumber(user.totalSpent, language)} icon={<CreditCard size={18} />} />
        </div>
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <Bot size={18} />
            {loc.telegramLogin}
          </div>
          <p className="mb-3 text-sm text-slate-700">{loc.telegramLoginHint}</p>
          <TelegramLoginButton
            clientId={telegramClientId}
            currentUserId={user.userId}
            language={language}
            onAttempt={onTelegramAttempt}
            onAuth={onTelegramAuth}
          />
          <TelegramDiagnosticsPanel
            language={language}
            attempt={telegramAttempt}
            diagnostics={telegramDiagnostics}
            isChecking={isCheckingTelegram}
            onCheck={onCheckTelegram}
          />
        </section>
      </div>
    </div>
  );
}

function LanguageView({
  language,
  isLoading,
  onSelect,
}: {
  language: Language;
  isLoading: boolean;
  onSelect: (language: Language) => Promise<void>;
}) {
  const loc = locale(language);
  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div>
          <h2 className="text-lg font-semibold">{loc.languageTitle}</h2>
          <p className="mt-1 text-sm text-slate-600">{loc.languageSelect}</p>
        </div>
        <div className="grid gap-2 sm:max-w-md sm:grid-cols-2">
          {(["ru", "en"] as Language[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => void onSelect(item)}
              disabled={isLoading}
              className={clsx(
                "flex h-12 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition disabled:opacity-60",
                language === item ? "border-ink bg-ink text-white" : "border-line bg-panel text-slate-800 hover:border-signal hover:bg-white",
              )}
            >
              {language === item ? <Check size={16} /> : <Languages size={16} />}
              {item === "ru" ? loc.russian : loc.english}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function HelpView({
  user,
  language,
  supportUrl,
  supportUsername,
}: {
  user: PublicUser;
  language: Language;
  supportUrl: string;
  supportUsername: string;
}) {
  const loc = locale(language);
  return (
    <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{loc.helpTitle}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{loc.helpScreen}</p>
        </div>
        <section className="rounded-lg border border-line bg-panel p-4">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <HelpCircle size={18} />
            {loc.support}
          </div>
          <p className="text-sm text-slate-700">{loc.supportText}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-line bg-white px-3 py-2 text-sm">{supportUsername}</code>
            <code className="rounded-md border border-line bg-white px-3 py-2 text-sm">
              {loc.userId}: {user.userId}
            </code>
            <a
              href={supportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <MessageSquare size={16} />
              {loc.support}
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border border-line bg-panel p-4">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-white text-slate-700">{icon}</div>
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 break-words text-lg font-semibold">{value}</div>
    </div>
  );
}
