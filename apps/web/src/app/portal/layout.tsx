import Link from "next/link";
import type { ReactNode } from "react";

export const metadata = { title: "Client Portal — Golden Key Wealth" };

/**
 * Client-portal shell: warm, minimal, and entirely separate from the staff
 * workspace — no staff navigation is reachable from here.
 */
export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-ivory">
      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-gold bg-ivory font-display text-sm text-gold-deep">
              GK
            </div>
            <div>
              <p className="font-display text-lg leading-tight text-ink">Golden Key Wealth</p>
              <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-gold-deep">
                Client Portal
              </p>
            </div>
          </div>
          <Link href="/" className="text-xs font-medium text-ink-soft hover:text-emerald">
            Sign out
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">{children}</main>
      <footer className="mx-auto max-w-3xl px-6 pb-8 text-center text-[11px] text-ink-faint">
        Prototype · Synthetic data only · Powered by AFLO
      </footer>
    </div>
  );
}
