# ADR-0004: pnpm Workspaces Monorepo

## Status

Accepted — 2026-07-17

## Context

The execution brief requires a monorepo containing a Next.js web app (Vercel), a background worker (Railway), and shared domain code. ADR-0001 (modular monolith) and ADR-0002 (shared repository interfaces) both depend on `apps/web` and `apps/worker` importing the same typed packages without publishing to a registry.

The team is small and the immediate goal is the first visual slice. Tooling should be the minimum that gives workspace linking, deterministic installs, and clean per-app deploys to two different platforms.

## Decision

Use **pnpm workspaces** as the monorepo mechanism, with no additional orchestration layer (no Turborepo, no Nx) for now.

```text
pnpm-workspace.yaml
apps/
  web/        # Next.js + TypeScript, deployed to Vercel
  worker/     # Node worker, deployed to Railway
packages/
  shared/     # domain types, repository interfaces, in-memory implementations (first slice)
```

Planned packages, added only when a slice needs them (per the README structure): `packages/database` (Neon-backed repositories), `packages/ui` (shared Tailwind components), `packages/rules` (versioned deterministic rules engine), `packages/ai` (provider interface + agent orchestration), and later `auth`, `reports`, `notifications`, `analytics`.

> **Amendment (2026-07-17, Product Charter reconciliation):** the charter mandates the full package layout up front. `packages/config` (shared ts/eslint base), `packages/rules` (dependency-free deterministic kernel + rule registry), and `packages/ai` (agent envelope) are now **real** — extracted from `shared` behind unchanged consumer imports. `database`, `auth`, `ui`, `reports`, `notifications`, and `analytics` exist as **documented thin stubs** (a manifest, an inert export, and a README naming the activating slice) so the layout is visible without speculative code. `packages/shared` re-exports `@aflo/rules`/`@aflo/ai` as a convenience facade for the single app consumer; this facade is scheduled for removal when `packages/database` activates and apps import each package directly.

> **Amendment (2026-07-18, partner-orchestration decision):** `packages/billing` is now **real** (deterministic billing kernel, `billing.v1.0.0`). `packages/integrations` (provider adapters) joins the charter stub set. Five gated partner-orchestration stubs are added per the founder decision and ADR-0007: `academy`, `partner-marketplace`, `credit-data`, `opportunity-intelligence`, `embedded-finance`. The "no placeholder packages ahead of need" convention below is amended: stubs **are** created when an authoritative founder decision or the charter mandates the boundary — but they stay inert (manifest + README naming the activating phase/gate), and gated stubs must state their unlock condition.

Conventions:

- Internal packages are consumed via `workspace:*` protocol; nothing is published.
- One root TypeScript base config; each package extends it. Type checking, linting, tests, and builds run via plain pnpm scripts (`pnpm -r typecheck`, etc.) and CI.
- Vercel builds `apps/web`; Railway builds `apps/worker`; both resolve workspace packages from the same lockfile.
- Empty placeholder packages are not created ahead of need, except where an authoritative founder decision or the charter mandates the boundary (see 2026-07-18 amendment) — such stubs stay inert and name their activating slice or gate.

## Consequences

Positive:

- Strict, non-flat `node_modules` catches undeclared dependencies early — useful for keeping module boundaries honest (ADR-0001).
- Content-addressed store makes installs fast and disk-cheap; single lockfile keeps web and worker dependency versions aligned.
- First-class Vercel and Railway support for pnpm workspaces; no custom build plumbing.
- No task-graph tool to learn, configure, or debug while the codebase is a handful of packages.

Negative / accepted costs:

- No remote build caching or task-graph awareness; CI runs the full `-r` pipeline. Acceptable at current package count; revisit when CI time or `changed-since` filtering becomes a real need.
- pnpm's strictness occasionally surfaces upstream packages with undeclared peer dependencies; resolved case-by-case via explicit dependencies (avoid blanket hoisting).

## Why Not Turborepo or Nx Yet

- **Turborepo** adds task caching and pipeline ordering — valuable at many packages or slow builds, but at 2 apps + 1–2 packages it is configuration without payoff. It layers cleanly on top of pnpm workspaces later, so deferring costs nothing.
- **Nx** brings generators, project-graph enforcement, and its own plugin ecosystem — more machinery and lock-in than a two-deployable monolith warrants, and its conventions would compete with the brief's own module structure.

Adopting Turborepo later (likely once `packages/rules`, `ai`, `database`, and `ui` exist and CI slows) is an incremental change to scripts and CI, not a restructure; it will get its own ADR if and when it happens.

## Alternatives Considered

1. **npm or Yarn workspaces.** Workable, but npm's flat hoisting hides undeclared dependencies, and Yarn (Berry) adds PnP/config complexity without offsetting benefit here. pnpm is the strictest and fastest of the three for this shape.
2. **Polyrepo (separate web, worker, shared-package repos).** Rejected: publishing `shared` to a registry for two consumers adds versioning friction exactly where ADR-0002's interface swap needs atomic cross-package changes.
3. **Turborepo or Nx now.** Rejected as premature; see above.
