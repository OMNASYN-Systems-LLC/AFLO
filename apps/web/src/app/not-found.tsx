import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-ivory px-6 text-center">
      <p className="font-display text-5xl text-gold">404</p>
      <h1 className="mt-3 font-display text-2xl text-ink">Not found</h1>
      <p className="mt-2 max-w-sm text-sm text-ink-soft">
        That record doesn&apos;t exist in this organization, or it lives outside your access.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 rounded-md bg-emerald px-4 py-2 text-sm font-medium text-ivory-ink hover:bg-emerald-deep"
      >
        Back to dashboard
      </Link>
    </main>
  );
}
