# ΛFLO Two-Level Brand System

## 0. Wordmark: ΛFLO (display) vs AFLO (technical) — founder rule (2026-07-18)

The official **display** brand is **ΛFLO** (Greek capital lambda `Λ` + `FLO`). The **technical / plain-text** form remains **AFLO**. These never blur:

| Use **ΛFLO** (display) | Use **AFLO** (technical / plain-text) |
|---|---|
| Product UI, marketing, reports, presentations | Repository & package names (`@aflo/*`), source code, identifiers |
| Academy branding, partner-facing & client-facing materials | Env vars, database identifiers, URLs, domains, APIs, logs |
| | **Accessibility fallbacks** and plain-text references |

- Full product reference: **AFLO — Autonomous Financial Lifecycle Orchestrator**.
- Initial implementation: **Golden Key Wealth, powered by ΛFLO**.
- In the web app, render the display mark via `components/brand.tsx` (`AfloWordmark` / `PoweredByAflo`): it shows `ΛFLO` visually with `aria-label="AFLO"`, so screen readers, search, and copy-paste get the plain-text brand.
- **Do not** rename `@aflo/*` namespaces, env vars, or any technical identifier to use the lambda. `<title>` tags and log lines stay `AFLO` (plain-text/accessibility).
- Academy: official name **ΛFLO Wealth Academy**; navigation label **Wealth Academy**. Natalia's content is the *Wealth Unlockers curriculum, delivered through the ΛFLO Wealth Academy*. Do not rename it to "Sovereign Academy" or "Golden Key Vault".

---

ΛFLO carries **two distinct identities** that must never blur: the **ΛFLO platform identity** (the company and control plane) and per-tenant identities, of which **Golden Key Wealth** is the first. Product surfaces are themed by tenant; platform surfaces (corporate site, platform admin, developer/docs, status) use the corporate identity.

## 1. AFLO platform identity — "Control Plane Delta" (Option B)

Founder-selected corporate identity (2026-07-18). The mark is the Control Plane Delta; final SVG assets are **not yet supplied**.

| Token | Value | Role |
|---|---|---|
| Midnight Obsidian | `#0F172A` | Primary surface / wordmark ink |
| Liquidity Blue | `#0284C7` | Accent, interactive, the Delta |
| Platinum Chalk | `#F8FAFC` | Light surface / reversed ink |

Rules:

- The comparison-board image used during selection is **not a production asset**. Until final SVGs are supplied, use the placeholder asset interface below — never embed raster mockups.
- The corporate palette is reserved for platform-level surfaces. It must not leak into tenant-facing coaching experiences.
- Voice: infrastructure-grade — precise, calm, no hype.

## 2. Golden Key Wealth tenant identity

Golden Key Wealth retains its own theme (see `DESIGN_SYSTEM.md` for tokens, typography, validated status palette, and component conventions): warm ivory surfaces, obsidian/charcoal ink, muted gold, deep emerald, slate — quiet authority, dignity, progress. Tenant surfaces: staff portal, client portal, client communications, reports.

## 3. Theming architecture

- Tenant themes are **configuration, not forks**: design tokens resolve per organization (Golden Key's theme is the first instance), so a future second tenant themes the same components.
- The platform identity is a fixed token set, not part of tenant configuration.
- Email templates and generated reports render with the **tenant** theme; platform notices (status, security) render with the **platform** identity.

## 4. Asset interfaces (placeholders until final SVGs)

```
packages/ui (future)
  assets/
    aflo/            # platform marks — placeholder: wordmark text "AFLO" + Delta glyph slot
    tenants/<slug>/  # tenant marks — Golden Key: existing "GK" monogram placeholder
```

Components must consume marks via an asset interface (`getBrandAssets(scope: "platform" | { tenant: slug })`) so dropping in final SVGs later changes no component code. Do not hand-draw or generate substitute logos; text-based placeholders only until official files arrive.
