import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClinCalc Pro | 醫師臨床決策系統",
  description: "ClinCalc Pro — 專為醫師設計的 AI 臨床決策支援平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-TW" data-app="pro" className="dark" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
