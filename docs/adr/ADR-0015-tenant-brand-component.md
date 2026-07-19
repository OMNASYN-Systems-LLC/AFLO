# ADR-0015: Centralized tenant-brand component (`OrganizationBrand`)

## Status

**Accepted** — 2026-07-19 (founder Production Readiness directive, "Brand implementation")

## Context

The founder approved a modern Golden Key Wealth logo and directed a single,
centralized brand component so no page hardcodes a mark — used across the
sign-in shells, staff nav, client portal, and (later) email/report/appointment/
billing headers. Two constraints shaped this decision:

1. **The raster assets are not in the repo yet.** Only a brand board exists;
   `primary-dark.png` / `primary-light.png` must still be supplied. The founder
   explicitly said not to auto-trace the raster into a "finished" trademark
   asset — the component must degrade to a text fallback until real artwork
   lands, then swap in the PNGs (and later the final SVGs) without touching
   consumers.
2. **The directive named `packages/ui/src/branding/OrganizationBrand.tsx`.**
   `packages/ui` is currently a stub with no React/JSX toolchain, and its own
   charter says "components live in `apps/web` until a second surface needs
   them." The only surface that renders a logo today is `apps/web`.

## Decision

- Build **`OrganizationBrand`** as the single source of truth for tenant
  branding, in `apps/web/src/components/branding.tsx` **for now**.
  - Config-driven (`OrganizationBrandConfig`): name, monogram, per-surface logo
    sources (`onDark` / `onLight`, `null` until supplied), reserved intrinsic
    size, and the `GOLDEN_KEY_THEME` palette (Onyx/Charcoal/Gold/White/Soft
    gray). Swapping a PNG for a future SVG is a one-line config change.
  - Renders the logo image once assets exist, else an **accessible text
    fallback** (monogram tile + wordmark) sized to the logo's reserved height so
    there is **no layout shift** on swap.
  - `headingLevel` prop exposes the tenant name as a page heading where
    appropriate (sign-in shell) while staying logo-only in nav/portal contexts;
    the accessible name is always the org name (image `alt` or wordmark text).
  - Tenant brand (Golden Key Wealth) is **separate** from the ΛFLO platform
    brand — the "Powered by ΛFLO" lockup is optional platform attribution.
  - `apps/web/public/brands/golden-key-wealth/README.md` documents the required
    files and the temporary-raster / final-SVG rules.

- **Relocate to `packages/ui/src/branding/OrganizationBrand.tsx`** the moment a
  second surface needs it — specifically the Railway worker's email and report
  headers. Because every consumer imports `OrganizationBrand`, the move is an
  import-path change, not a rewrite. `packages/ui` will be stood up as a real
  React component package (React peer dep, JSX tsconfig, `transpilePackages`
  entry) at that point.

## Alternatives Considered

1. **Stand up `packages/ui` as a JSX package now and put the component there
   (as the directive literally said).** Rejected for now: it adds a new
   React/JSX toolchain (peer deps, jsx tsconfig, Next `transpilePackages`
   wiring, lint config) with **no second consumer yet**, contradicting
   `packages/ui`'s own "until a second surface needs them" rule and the
   directive's own challenge-mode test ("Is there a smaller, safer
   implementation?"). The relocation is cheap and is triggered by the concrete
   need (worker email/report headers), so we defer the package infra to then.
2. **Auto-trace the raster board into an SVG and ship it as the logo.**
   Rejected — the founder explicitly prohibited treating the temporary raster as
   the final trademark master; the text fallback is the honest placeholder.
3. **Keep the hardcoded "GK" mark inline on each page.** Rejected — the whole
   point is one centralized component so branding can't drift page to page.
