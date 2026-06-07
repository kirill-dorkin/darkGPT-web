"use client";

import clsx from "clsx";
import {
  Bot,
  CheckCircle2,
  Copy,
  Loader2,
  PanelLeft,
  RotateCcw,
  Send,
  Sparkles,
  User,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { FormEvent, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  meta?: string;
};

type ChatResponse = {
  text?: string;
  provider?: string;
  model?: string;
  error?: string;
};

const quickPrompts = [
  "Составь структуру сайта по продаже техники: каталог, карточка товара, корзина, оплата.",
  "Напиши продающее описание для магазина ноутбуков и смартфонов.",
  "Сделай чеклист запуска интернет-магазина техники.",
  "Сгенерируй HTML-блок карточки товара с Tailwind.",
];

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Готов. Пиши задачу, а я отвечу структурно: план, код, текст, таблица или чеклист. Интерфейс использует тот же OpenAI-compatible backend, что и бот.",
    meta: "DarkGPT Web",
  },
];

function nextId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function ChatShell() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const canSend = input.trim().length > 0 && !isLoading;
  const messageCount = useMemo(() => messages.filter((message) => message.role === "user").length, [messages]);

  async function sendMessage(messageText = input) {
    const trimmed = messageText.trim();
    if (!trimmed || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: nextId(),
      role: "user",
      content: trimmed,
      meta: "Вы",
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      const data = (await response.json()) as ChatResponse;
      const answerText = data.text;
      if (!response.ok || data.error || !answerText) {
        throw new Error(data.error || "AI service unavailable");
      }

      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          content: answerText,
          meta: [data.provider, data.model].filter(Boolean).join(" / ") || "AI",
        },
      ]);
    } catch (requestError) {
      const message = requestError instanceof Error ? requestError.message : "AI service unavailable";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: nextId(),
          role: "assistant",
          content: `Не получилось получить ответ.\n\nПричина: ${message}`,
          meta: "Ошибка",
        },
      ]);
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
    setMessages(initialMessages);
    setError("");
    setInput("");
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
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-ink text-white">
                  <Bot size={22} />
                </div>
                <div>
                  <h1 className="text-lg font-semibold leading-tight">DarkGPT Web</h1>
                  <p className="text-sm text-slate-600">AI-интерфейс для сайта</p>
                </div>
              </div>
            </div>

            <div className="space-y-5 p-5">
              <section>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <CheckCircle2 size={16} className="text-accent" />
                  Статус
                </div>
                <div className="rounded-md border border-line bg-white p-3 text-sm text-slate-700">
                  Backend подключается через `/api/chat`. Provider и модель берутся из env на сервере.
                </div>
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Sparkles size={16} className="text-signal" />
                  Быстрые запросы
                </div>
                <div className="space-y-2">
                  {quickPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      disabled={isLoading}
                      className="w-full rounded-md border border-line bg-white px-3 py-2 text-left text-sm text-slate-700 transition hover:border-signal hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="mt-auto border-t border-line p-5">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md border border-line bg-white p-3">
                  <div className="text-slate-500">Запросов</div>
                  <div className="mt-1 text-xl font-semibold">{messageCount}</div>
                </div>
                <div className="rounded-md border border-line bg-white p-3">
                  <div className="text-slate-500">Режим</div>
                  <div className="mt-1 flex items-center gap-1 font-semibold">
                    <Zap size={15} className="text-accent" />
                    Live
                  </div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        <section className="flex min-h-[calc(100vh-24px)] min-w-0 flex-col">
          <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSidebarOpen((value) => !value)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-line text-slate-700 transition hover:border-signal hover:text-ink"
                title="Панель"
              >
                <PanelLeft size={18} />
              </button>
              <div>
                <div className="text-sm text-slate-500">Чат</div>
                <div className="font-semibold">Новая сессия</div>
              </div>
            </div>
            <button
              type="button"
              onClick={resetChat}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line px-3 text-sm text-slate-700 transition hover:border-warning hover:text-warning"
            >
              <RotateCcw size={16} />
              Сброс
            </button>
          </header>

          <div className="flex-1 overflow-y-auto bg-white px-4 py-5 sm:px-6">
            <div className="mx-auto flex max-w-4xl flex-col gap-4">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}
              {isLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-line bg-panel px-4 py-3 text-sm text-slate-600">
                  <Loader2 size={17} className="animate-spin" />
                  Генерирую ответ
                </div>
              ) : null}
              {error ? (
                <div className="rounded-md border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                  {error}
                </div>
              ) : null}
            </div>
          </div>

          <form onSubmit={handleSubmit} className="border-t border-line bg-panel p-3 sm:p-4">
            <div className="mx-auto flex max-w-4xl gap-2 rounded-lg border border-line bg-white p-2 shadow-sm">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
                maxLength={4000}
                placeholder="Напиши задачу. Shift+Enter для новой строки."
                className="max-h-40 min-h-[48px] flex-1 resize-none rounded-md border-0 px-3 py-2 text-sm outline-none placeholder:text-slate-400"
              />
              <button
                type="submit"
                disabled={!canSend}
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-ink text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                title="Отправить"
              >
                {isLoading ? <Loader2 size={20} className="animate-spin" /> : <Send size={19} />}
              </button>
            </div>
            <div className="mx-auto mt-2 flex max-w-4xl justify-between text-xs text-slate-500">
              <span>Ответы отображаются в Markdown.</span>
              <span>{input.length}/4000</span>
            </div>
          </form>
        </section>
      </div>
    </main>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  async function copyMessage() {
    await navigator.clipboard.writeText(message.content);
  }

  return (
    <article className={clsx("flex gap-3", isUser ? "justify-end" : "justify-start")}>
      {!isUser ? (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink text-white">
          <Bot size={18} />
        </div>
      ) : null}

      <div className={clsx("min-w-0 max-w-[88%] rounded-lg border px-4 py-3", isUser ? "border-signal bg-blue-50" : "border-line bg-panel")}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {isUser ? <User size={13} /> : <Bot size={13} />}
            {message.meta || (isUser ? "Вы" : "AI")}
          </div>
          <button
            type="button"
            onClick={copyMessage}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white hover:text-ink"
            title="Копировать"
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
