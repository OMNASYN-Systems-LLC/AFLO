# Golden Key Design System

**Product:** Golden Key Wealth, powered by AFLO
**Status:** As implemented. Tokens live in `apps/web/src/app/globals.css`; components in `apps/web/src/components/`. This document describes what exists — it does not propose new tokens.

---

## 1. Principles

From the Product Charter's design-system section:

- Communicate **quiet authority, safety, dignity, intelligence, progress, service**.
- **Plain language** everywhere; no jargon, no unexplained scores or black-box classifications.
- **The next action is always more prominent than analytics.** Dashboards serve the work, not the other way around.
- **No shame-based language.** Stage and status are framed as position and progress, never judgment.
- **No unexplained good/bad labels.** Every status carries a reason a human can read (stage reason codes, review states, labeled badges).
- Spacious layouts, strong typography, restrained status indicators, accessible contrast, clear hierarchy.

## 2. Color Tokens

All values are the actual tokens in `globals.css` (`@theme`). Restrained, editorial, unhurried: obsidian + warm ivory + muted gold + deep emerald + slate.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--color-ivory` | `#f7f4ec` | Page background |
| `--color-card` | `#fdfbf5` | Card/section surfaces |
| `--color-parchment` | `#efe9dc` | Recessed surfaces |
| `--color-sand` | `#e6dfcd` | Track/empty fills (bars, stage segments) |
| `--color-line` | `#ddd5c2` | Borders and dividers |
| `--color-obsidian` | `#191b16` | Darkest surface (shell/chrome) |
| `--color-charcoal` | `#242720` | Dark surface |
| `--color-charcoal-soft` | `#31352c` | Dark surface, raised |

### Ink

| Token | Value | Use |
|---|---|---|
| `--color-ink` | `#21241d` | Primary text on light surfaces |
| `--color-ink-soft` | `#5b6157` | Secondary text, labels |
| `--color-ink-faint` | `#878d80` | Hints, empty states, zero values |
| `--color-ivory-ink` | `#f2efe6` | Primary text on dark surfaces |
| `--color-ivory-ink-soft` | `#b9b7a9` | Secondary text on dark surfaces |

### Brand accents

| Token | Value | Use |
|---|---|---|
| `--color-gold` | `#a2803f` | Muted gold — current-stage marker, lead accent |
| `--color-gold-deep` | `#7d6127` | Gold text on tinted chips |
| `--color-gold-soft` | `#c9b078` | Soft gold accents |
| `--color-emerald` | `#1c5b48` | Deep emerald — completed stages, client accent |
| `--color-emerald-deep` | `#14453a` | Emerald text on tinted chips |

### Data and status palette (accessibility-validated)

Validated with the dataviz palette checks against the ivory surface, including color-vision-deficiency separation and contrast.

| Token | Value | Meaning |
|---|---|---|
| `--color-mark-emerald` | `#0f8560` | The single data-mark hue for magnitude bars and progress fills |
| `--color-status-good` | `#1e8259` | Good / approved / active |
| `--color-status-warn` | `#b3891f` | Warn / in review / cooling |
| `--color-status-risk` | `#a03a14` | Risk / needs attention / at risk |
| `--color-status-calm` | `#4d68b0` | Calm / informational / dormant / uploaded |

Badge backgrounds use matching tints on ivory: `--color-status-good-tint #e0eee5`, `--color-status-warn-tint #f2ead1`, `--color-status-risk-tint #f5e2d8`, `--color-status-calm-tint #e2e7f3`, `--color-neutral-tint #e9e4d6`.

**Rules:**

- **Status is never color alone.** Every badge carries a text label; bars carry direct value labels; the stage track carries an `aria-label` and per-segment tooltips.
- The warn gold (`#b3891f`) sits **below 3:1 contrast** against ivory as a standalone graphic; this is compensated by the rule above — it never appears without a visible text label, and warn chip text uses the darker `gold-deep`.

## 3. Typography

Both stacks are system-native (no webfonts):

- **Display serif** (`--font-display`): `"Iowan Old Style", "Palatino Linotype", "Book Antiqua", Palatino, Georgia, "Times New Roman", serif`. Used for section titles (`SectionCard` headers) and large stat values.
- **Sans** (`--font-sans`): `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. Used for body, labels, and data.
- Body sets `font-feature-settings: "kern", "liga"` and antialiasing.

**Label convention:** small labels (e.g., `StatTile`) are uppercase, `11px`, medium weight, with wide tracking (`tracking-[0.14em]`), in `ink-soft`. Counts and numeric columns use `tabular-nums`.

## 4. Anti-Patterns

Per the charter — never use:

- Generic AI gradients or purple/blue neon
- Robot or crypto imagery
- Excessive glassmorphism
- Dense dashboards (spacious layout wins; analytics never outrank the next action)
- Shame-based language or unexplained good/bad labels

## 5. Component Conventions

As implemented in `apps/web/src/components/`:

- **Badge** (`badges.tsx`) — pill chip: `rounded-full px-2.5 py-0.5 text-xs font-medium`, an `aria-hidden` 1.5-unit dot plus **always** a text label. Tones: `good`, `warn`, `risk`, `calm`, `neutral` (tinted backgrounds) and `emerald`/`gold` (outlined brand variants for stage/kind). Domain wrappers map enums to tone + label: `EngagementBadge`, `StageBadge`, `KindBadge`, `PipelineBadge`, `DocStatusBadge`, `ReportStatusBadge`, `ReviewStatusBadge`.
- **StatTile** (`ui.tsx`) — bordered `card` surface; uppercase tracked label, `font-display text-3xl` value, optional `ink-faint` hint.
- **SectionCard** (`ui.tsx`) — `rounded-lg border-line bg-card`; header with `font-display` title, optional subtitle and action slot; padded body.
- **ProgressBar** (`ui.tsx`) — single-hue magnitude bar: `mark-emerald` fill on a `sand` track, with the value labeled directly beside it (never color alone).
- **StageDistribution** (`stage.tsx`) — single ordinal series, one hue (`mark-emerald`), direct value labels per row, 4px-rounded data ends anchored to the baseline; zero values render a tick, not an empty bar.
- **StageTrack** (`stage.tsx`) — compact eight-segment lifecycle indicator: `emerald` for completed stages, `gold` for the current stage, `sand` for upcoming; labeled via `aria-label` and per-segment `title` tooltips.
- **EmptyState** (`ui.tsx`) — dashed `line` border on `ivory`, centered `ink-faint` message.

When adding a component: reuse these tokens, keep one hue per data series, label every status and value in text, and keep the client's next action visually dominant over any chart.
