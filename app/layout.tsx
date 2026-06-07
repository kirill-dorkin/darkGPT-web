import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";

export const metadata: Metadata = {
  title: "DarkGPT Web",
  description: "Web chat interface for DarkGPT",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>
        {children}
        <Script src="https://oauth.telegram.org/js/telegram-login.js?5" strategy="afterInteractive" />
      </body>
    </html>
  );
}
