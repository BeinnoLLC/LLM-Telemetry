import type { Metadata } from "next";
import type { ReactNode } from "react";
import AppShell from "@/components/AppShell";
import LegacyHashRedirect from "@/components/LegacyHashRedirect";
import "./globals.css";
import "../styles/home-base.css";

export const metadata: Metadata = {
  title: "LLM Telemetry",
  description:
    "LLM Telemetry dashboard — Next.js migration scaffold (T-0, LST-281).",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
        <LegacyHashRedirect />
      </body>
    </html>
  );
}
