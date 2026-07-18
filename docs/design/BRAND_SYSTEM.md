# AFLO Two-Level Brand System

AFLO carries **two distinct identities** that must never blur: the **AFLO platform identity** (the company and control plane) and per-tenant identities, of which **Golden Key Wealth** is the first. Product surfaces are themed by tenant; platform surfaces (corporate site, platform admin, developer/docs, status) use the corporate identity.

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
