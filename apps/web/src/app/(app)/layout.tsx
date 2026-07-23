import Link from "next/link";
import { PoweredByAflo } from "@/components/brand";
import { NavLink } from "@/components/nav-link";
import { getDemoShellIdentity } from "@/lib/data";
import { fmtDate, initials, STAFF_ROLE_LABELS } from "@/lib/format";

// Founder staff navigation: Dashboard, Leads, Clients, Tasks, Reports,
// Partners, Billing, Settings — plus the Human Review Center (founder
// directive 2026-07-20: human-in-the-loop is first-class workflow
// architecture). The first four are live; the rest surface as their slices
// land.
const COMING_SOON = ["Tasks", "Reports", "Partners", "Billing", "Settings"];

// Render at REQUEST time, never at build (ADR-0048 / PR #99 M1, extended by
// ADR-0052): this shell reads demo identity via the GATED `getDemoShellIdentity()`,
// so — like every `(app)` data page that reads `lib/data.ts` — it must be
// force-dynamic. Otherwise `next build` would invoke the gated accessor with no
// opt-in and fail; deferring to request time keeps the accessor's throw where it
// belongs (a real-cell request, never the build) and bakes zero synthetic bytes.
export const dynamic = "force-dynamic";

export default function AppShellLayout({ children }: { children: React.ReactNode }) {
  // Fail closed exactly like the data pages: outside the explicit demo opt-in
  // this throws BEFORE any synthetic identity renders into the shell (ADR-0052,
  // closing the LOW-2 ungated-constant leak). Under APP_ENV=demo it returns the
  // personas unchanged, so demo previews render identically.
  const { staff, now } = getDemoShellIdentity();
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col bg-obsidian px-4 py-6">
        <Link href="/dashboard" className="flex items-center gap-3 px-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gold/70 font-display text-sm text-gold-soft">
            GK
          </span>
          <span>
            <span className="block font-display text-base leading-tight text-ivory-ink">
              Golden Key Wealth
            </span>
            <PoweredByAflo className="block text-[10px] font-medium uppercase tracking-[0.22em] text-gold-soft" />
          </span>
        </Link>

        <nav className="mt-8 space-y-1">
          <NavLink href="/dashboard">Dashboard</NavLink>
          <NavLink href="/leads">Lead Pipeline</NavLink>
          <NavLink href="/clients">Clients</NavLink>
          <NavLink href="/reviews">Review Center</NavLink>
        </nav>

        <div className="mt-8">
          <p className="px-3 text-[10px] font-medium uppercase tracking-[0.18em] text-ivory-ink-soft/70">
            Coming soon
          </p>
          <ul className="mt-2 space-y-1">
            {COMING_SOON.map((item) => (
              <li key={item} className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-ivory-ink-soft/50">
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-auto border-t border-charcoal-soft pt-4">
          <div className="flex items-center gap-3 px-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-charcoal-soft text-xs font-medium text-ivory-ink">
              {initials(staff.name)}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm text-ivory-ink">{staff.name}</span>
              <span className="block text-[11px] text-ivory-ink-soft">
                {STAFF_ROLE_LABELS[staff.role]}
              </span>
            </span>
          </div>
          <Link
            href="/"
            className="mt-3 block rounded-md px-3 py-1.5 text-xs text-ivory-ink-soft transition-colors hover:bg-charcoal hover:text-ivory-ink"
          >
            Sign out
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-line bg-ivory px-8">
          <p className="text-sm text-ink-soft">{fmtDate(now.toISOString())}</p>
          <p className="rounded-full border border-gold/40 bg-status-warn-tint px-3 py-1 text-[11px] font-medium text-gold-deep">
            Prototype · synthetic data only
          </p>
        </header>
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}
