import { DEFAULT_LANGUAGE, Language } from "@/lib/constants";

type LocaleValues = Record<string, string>;

type LocaleKey = keyof typeof LOCALES.ru;

const LOCALES = {
  ru: {
    languageFirstRun: "Choose your interface language.\nВыберите язык интерфейса.",
    menuIntro:
      "Просто напиши вопрос - я отвечу.\n\nБесплатно сегодня: {free}/3\nБаланс: {balance} кредитов",
    menu: "Бесплатно сегодня: {free}/3\nБаланс: {balance} кредитов",
    chatScreen: "Напиши свой вопрос одним сообщением.",
    chatStatusFree: "Бесплатно сегодня: {free}/3\nБаланс: {balance} кредитов",
    chatStatusCredits: "Списано: {cost} кредитов\nБаланс: {balance} кредитов",
    limitReached:
      "Лимит на сегодня закончился. Ты использовал бесплатные запросы: {free_used}/{free_total}. Чтобы продолжить, пополни баланс.",
    notEnoughCredits:
      "Недостаточно кредитов. Бесплатные запросы на сегодня закончились, а баланса не хватает для этого запроса.",
    requestTooLong: "Запрос слишком длинный. Сократи сообщение и попробуй снова.",
    aiUnavailable: "Не удалось получить ответ. Попробуй ещё раз через минуту. Запрос не был списан.",
    balanceScreen:
      "Кредиты используются для запросов к DarkGPT. Они не сгорают и тратятся только после успешного ответа.",
    packageTitle: "${price} -> {credits} кредитов",
    topupConfirm:
      "Сумма: ${price}\nК зачислению: {credits} кредитов\n\nОплата проходит через Crypto Bot.",
    invoiceCreated:
      "Счёт создан.\n\nСумма: ${price}\nК зачислению: {credits} кредитов\nСтатус: ожидает оплаты.",
    paymentPending: "Оплата пока не найдена. Если уже оплатил, подожди несколько секунд и проверь ещё раз.",
    paymentSuccess: "Баланс пополнен. Зачислено: {credits} кредитов. Текущий баланс: {balance} кредитов.",
    paymentExpired: "Срок оплаты истёк. Создай новый счёт и попробуй снова.",
    paymentCreateError: "Не удалось создать счёт. Попробуй ещё раз через минуту.",
    profileTitle: "Профиль",
    balanceTitle: "Баланс",
    referralTitle: "Рефералы",
    languageTitle: "Язык",
    helpTitle: "Помощь",
    chatTitle: "Чат",
    navChat: "Чат",
    navBalance: "Баланс",
    navReferral: "Рефералы",
    navProfile: "Профиль",
    navLanguage: "Язык",
    navHelp: "Помощь",
    send: "Отправить",
    reset: "Сброс",
    copy: "Копировать",
    copied: "Скопировано",
    generating: "Генерирую ответ",
    you: "Вы",
    assistant: "DarkGPT",
    newSession: "Новая сессия",
    placeholder: "Напиши задачу.",
    markdownNote: "Markdown",
    live: "Live",
    mode: "Режим",
    requests: "Запросов",
    requestCost: "Цена запроса",
    freeToday: "Бесплатно сегодня",
    currentBalance: "Текущий баланс",
    credits: "кредитов",
    topUp: "Пополнить",
    createInvoice: "Создать счёт",
    payCrypto: "Оплатить через Crypto Bot",
    checkPayment: "Проверить оплату",
    goToChat: "Перейти в чат",
    back: "Назад",
    choosePackage: "Выбери сумму пополнения",
    referralText:
      "Приглашай друзей и получай кредиты: +50 за нового пользователя и +200 за первое пополнение друга.",
    referralLink: "Твоя ссылка",
    invited: "Приглашено",
    paidReferrals: "Пополнили баланс",
    share: "Поделиться",
    languageSelect: "Выбери язык интерфейса.",
    languageChanged: "Язык изменён.",
    joinedByReferral:
      "Ты пришёл по приглашению. После первого сообщения тебе доступно 3 бесплатных запроса на сегодня.",
    helpScreen:
      "DarkGPT отвечает на вопросы, помогает с текстами, идеями, кодом, обучением и анализом.\n\nБесплатно: 3 запроса в день\nПополнение: через Crypto Bot\nКредиты: не сгорают",
    support: "Поддержка",
    supportText: "Если что-то не работает, напиши в поддержку и укажи свой ID.",
    totalPurchased: "Всего куплено",
    totalSpent: "Всего потрачено",
    userId: "ID",
    interfaceLanguage: "Язык",
    russian: "Русский",
    english: "English",
    errorGeneric: "Не удалось выполнить действие. Попробуй позже.",
    startingNotice: "DarkGPT запускает модель. Ответ может занять до минуты.",
    demoWelcome:
      "Готов. Пиши задачу, а я отвечу структурно: план, код, текст, таблица или чеклист.",
  },
  en: {
    languageFirstRun: "Choose your interface language.\nВыберите язык интерфейса.",
    menuIntro:
      "Just ask a question - I'll answer.\n\nFree today: {free}/3\nBalance: {balance} credits",
    menu: "Free today: {free}/3\nBalance: {balance} credits",
    chatScreen: "Send your question in one message.",
    chatStatusFree: "Free today: {free}/3\nBalance: {balance} credits",
    chatStatusCredits: "Spent: {cost} credits\nBalance: {balance} credits",
    limitReached:
      "Free limit reached. You used your free requests today: {free_used}/{free_total}. Top up your balance to continue.",
    notEnoughCredits:
      "Not enough credits. Your free requests for today are over and your balance is too low for this request.",
    requestTooLong: "Request is too long. Shorten it and try again.",
    aiUnavailable: "Could not get an answer. Try again in a minute. No credits were spent.",
    balanceScreen:
      "Credits are used for DarkGPT requests. They do not expire and are spent only after a successful answer.",
    packageTitle: "${price} -> {credits} credits",
    topupConfirm:
      "Amount: ${price}\nYou receive: {credits} credits\n\nPayment is processed through Crypto Bot.",
    invoiceCreated:
      "Invoice created.\n\nAmount: ${price}\nYou receive: {credits} credits\nStatus: waiting for payment.",
    paymentPending: "Payment not found yet. If you have already paid, wait a few seconds and check again.",
    paymentSuccess: "Balance topped up. Added: {credits} credits. Current balance: {balance} credits.",
    paymentExpired: "Invoice expired. Create a new invoice and try again.",
    paymentCreateError: "Could not create invoice. Try again in a minute.",
    profileTitle: "Profile",
    balanceTitle: "Balance",
    referralTitle: "Referrals",
    languageTitle: "Language",
    helpTitle: "Help",
    chatTitle: "Chat",
    navChat: "Chat",
    navBalance: "Balance",
    navReferral: "Referrals",
    navProfile: "Profile",
    navLanguage: "Language",
    navHelp: "Help",
    send: "Send",
    reset: "Reset",
    copy: "Copy",
    copied: "Copied",
    generating: "Generating answer",
    you: "You",
    assistant: "DarkGPT",
    newSession: "New session",
    placeholder: "Write a task.",
    markdownNote: "Markdown",
    live: "Live",
    mode: "Mode",
    requests: "Requests",
    requestCost: "Request cost",
    freeToday: "Free today",
    currentBalance: "Current balance",
    credits: "credits",
    topUp: "Top up",
    createInvoice: "Create invoice",
    payCrypto: "Pay with Crypto Bot",
    checkPayment: "Check payment",
    goToChat: "Go to chat",
    back: "Back",
    choosePackage: "Choose a top-up amount",
    referralText:
      "Invite friends and earn credits: +50 for a new user and +200 for a friend's first top-up.",
    referralLink: "Your link",
    invited: "Invited",
    paidReferrals: "Topped up",
    share: "Share",
    languageSelect: "Choose your interface language.",
    languageChanged: "Language changed.",
    joinedByReferral: "You joined through an invite. You have 3 free requests available today.",
    helpScreen:
      "DarkGPT answers questions and helps with writing, ideas, code, learning, and analysis.\n\nFree: 3 requests per day\nTop-up: through Crypto Bot\nCredits: do not expire",
    support: "Support",
    supportText: "If something is not working, contact support and include your ID.",
    totalPurchased: "Total purchased",
    totalSpent: "Total spent",
    userId: "ID",
    interfaceLanguage: "Language",
    russian: "Русский",
    english: "English",
    errorGeneric: "Could not complete the action. Try again later.",
    startingNotice: "DarkGPT is starting the model. The answer may take up to a minute.",
    demoWelcome:
      "Ready. Send a task and I will answer with a plan, code, text, table, or checklist.",
  },
} as const satisfies Record<Language, LocaleValues>;

export function locale(language?: string | null) {
  return LOCALES[language === "en" || language === "ru" ? language : DEFAULT_LANGUAGE];
}

export function t(language: string | null | undefined, key: LocaleKey, values: Record<string, string | number> = {}) {
  return format(locale(language)[key], values);
}

export function format(template: string, values: Record<string, string | number> = {}) {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export function languageName(language: Language) {
  return language === "ru" ? LOCALES.ru.russian : LOCALES.en.english;
}
