import Link from "next/link";
import { OrganizationBrand } from "@/components/branding";

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
            <OrganizationBrand surface="light" headingLevel={1} />

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
