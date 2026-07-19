# Golden Key Wealth — brand assets

The `OrganizationBrand` component (`apps/web/src/components/branding.tsx`) renders
this tenant's logo. **The image assets are not yet in the repo**, so the
component currently renders an accessible **text fallback** (monogram tile +
wordmark). Drop the approved files here to switch it on — no code change is
needed beyond pointing `GOLDEN_KEY_BRAND.logo.onDark` / `.onLight` at them.

## Required files (supply these)

| File | Use | Notes |
| --- | --- | --- |
| `primary-dark.png` | logo for **dark** backgrounds (sign-in shell, app icon) | wire to `logo.onDark` |
| `primary-light.png` | logo for **light** backgrounds (letters, reports, invoices) | wire to `logo.onLight` |

## Important

- These raster PNGs are **temporary prototype assets**, not the final
  trademark master. Do **not** auto-trace them into an SVG and treat that as a
  production logo. Final production artwork must be professionally redrawn as
  clean vectors:
  `golden-key-wealth-horizontal.svg`, `golden-key-wealth-stacked.svg`,
  `golden-key-wealth-mark.svg`, `favicon.svg`, `app-icon.png`.
- When the final SVGs are supplied, point the same `logo.onDark` / `.onLight`
  paths at them. Because consumers only ever import `OrganizationBrand`, the
  swap touches nothing else.
- Tenant branding (Golden Key Wealth) is intentionally separate from the ΛFLO
  platform brand. Display lockup: **Golden Key Wealth**, with **Powered by ΛFLO**
  beneath. Never distort or recreate the logo in CSS.

## Palette (founder brand tokens — mirrored in `GOLDEN_KEY_THEME`)

Onyx `#0A0A0A` · Charcoal `#1A1A1A` · Gold `#D4AF37` · White `#FFFFFF` · Soft gray `#F5F5F3`
