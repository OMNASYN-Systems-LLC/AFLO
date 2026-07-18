import Link from "next/link";

/**
 * Staff sign-in shell — visual only. Real authentication (Clerk or Auth.js)
 * replaces this screen when the first slice moves past synthetic data.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-obsidian px-6">
      <div className="w-full max-w-md">
        <div className="rounded-xl border border-charcoal-soft bg-ivory p-10 shadow-2xl">
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-md border border-gold bg-ivory font-display text-lg tracking-tight text-gold-deep">
              GK
            </div>
            <h1 className="mt-5 font-display text-3xl text-ink">Golden Key Wealth</h1>
            <p className="mt-2 text-[11px] font-medium uppercase tracking-[0.28em] text-gold-deep">
              Powered by AFLO
            </p>
            <p className="mt-4 text-sm leading-relaxed text-ink-soft">
              Financial readiness, retention, and trusted progress — one workspace for
              your team and your clients.
            </p>
          </div>

          <div className="mt-8 space-y-3">
            <Link
              href="/dashboard"
              className="block w-full rounded-md bg-emerald px-4 py-2.5 text-center text-sm font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
            >
              Continue as Golden Key Staff
            </Link>
            <Link
              href="/portal"
              className="block w-full rounded-md border border-line px-4 py-2.5 text-center text-sm text-ink-soft transition-colors hover:border-gold/60 hover:text-gold-deep"
            >
              Continue as Sample Client (demo)
            </Link>
          </div>
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-ivory-ink-soft">
          Prototype environment · Synthetic data only · No real financial information
        </p>
      </div>
    </main>
  );
}
