import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Golden Key Wealth — powered by AFLO",
    template: "%s · Golden Key Wealth",
  },
  description:
    "Financial readiness, client retention, and workflow platform. Prototype with synthetic data only.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
