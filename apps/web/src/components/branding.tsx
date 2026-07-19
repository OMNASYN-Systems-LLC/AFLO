import Image from "next/image";
import { PoweredByAflo } from "@/components/brand";

/**
 * Centralized tenant brand system. ONE component renders the organization's
 * logo everywhere (sign-in shells, nav, portal, email/report headers later) so
 * no page hardcodes a mark. Tenant branding (Golden Key Wealth) is kept
 * separate from the ΛFLO platform brand: this component shows the tenant, and
 * the "Powered by ΛFLO" lockup is the platform attribution beneath it.
 *
 * Placement note (ADR-0015): this lives in apps/web while the web app is the
 * only surface that renders a logo. It moves to packages/ui/src/branding the
 * moment a second surface (the Railway worker's email/report headers) needs it
 * — packages/ui's documented migration trigger. Consumers import
 * `OrganizationBrand`, so that relocation won't touch call sites.
 */

/**
 * Golden Key Wealth's approved palette — the five official swatches from the
 * founder brand guide (2026-07-19). Source of truth for the tenant brand; kept
 * separate from the ΛFLO platform tokens in globals.css. `softGray` is a derived
 * light surface (not one of the five), retained for backgrounds.
 */
export const GOLDEN_KEY_THEME = {
  gold: "#D4AF37",
  white: "#FFFFFF",
  onyx: "#0A0A0A", // black
  charcoal: "#1E1E1E", // dark
  gray: "#6B6B6B",
  softGray: "#F5F5F3", // derived
} as const;

/** Golden Key Wealth brand voice (founder brand guide). */
export const GOLDEN_KEY_VOICE = {
  tagline: "Strategy. Clarity. Freedom.",
  positioning:
    "Modern wealth management built on strategy, clarity, and generational impact. We unlock financial freedom through intelligent solutions and unwavering guidance.",
  values: ["Strategic", "Trusted", "Innovative", "Empowering"] as const,
} as const;

export interface OrganizationBrandConfig {
  /** Display + accessible name (the logo's alt text and the wordmark text). */
  name: string;
  /** Short monogram used by the text fallback. */
  monogram: string;
  /**
   * Logo asset sources by the background it sits on. `null` until the real
   * artwork is supplied — the component renders the text fallback meanwhile.
   * Swapping a raster path for a future `.svg` here changes nothing for
   * consumers (they never reference the asset directly).
   */
  logo: {
    onDark: string | null;
    onLight: string | null;
    /** Intrinsic size, reserved even for the fallback so there is no layout shift. */
    width: number;
    height: number;
  };
  theme: typeof GOLDEN_KEY_THEME;
  /** Short brand tagline (e.g. "Strategy. Clarity. Freedom."). */
  tagline?: string;
}

export const GOLDEN_KEY_BRAND: OrganizationBrandConfig = {
  name: "Golden Key Wealth",
  monogram: "GK",
  // Temporary raster assets are NOT yet in the repo; render the text fallback
  // until apps/web/public/brands/golden-key-wealth/{primary-dark,primary-light}.png
  // (or their final SVGs) are supplied. See that folder's README.
  logo: { onDark: null, onLight: null, width: 208, height: 44 },
  theme: GOLDEN_KEY_THEME,
  tagline: GOLDEN_KEY_VOICE.tagline,
};

/** Which background the mark sits on — picks the logo variant and fallback colors. */
export type BrandSurface = "dark" | "light";

export interface OrganizationBrandProps {
  brand?: OrganizationBrandConfig;
  surface?: BrandSurface;
  /** Render the tenant name as a heading of this level (e.g. the page's h1). Omit for logo-only contexts (nav). */
  headingLevel?: 1 | 2;
  /** Show the "Powered by ΛFLO" platform lockup beneath the tenant mark. */
  showPoweredBy?: boolean;
  /** Show the tenant tagline (e.g. "Strategy. Clarity. Freedom.") beneath the mark. */
  showTagline?: boolean;
  className?: string;
}

/**
 * The organization's brand lockup. Renders the tenant logo (once supplied) or a
 * text fallback, plus the optional ΛFLO platform attribution. Responsive and
 * layout-shift-free. When `headingLevel` is set, the tenant name is exposed as
 * a heading (the accessible name is always "<org name>", whether from the image
 * alt text or the wordmark).
 */
export function OrganizationBrand({
  brand = GOLDEN_KEY_BRAND,
  surface = "light",
  headingLevel,
  showPoweredBy = true,
  showTagline = false,
  className,
}: OrganizationBrandProps) {
  const src = surface === "dark" ? brand.logo.onDark : brand.logo.onLight;
  const NameTag = (headingLevel ? (`h${headingLevel}` as const) : "span") as "h1" | "h2" | "span";
  const nameColor = surface === "dark" ? "text-ivory" : "text-ink";

  return (
    <span className={`inline-flex flex-col items-center gap-2 ${className ?? ""}`} data-org-brand={brand.name}>
      {src ? (
        // The heading (when requested) wraps the image; its alt text is the accessible name.
        <NameTag className="m-0 leading-none">
          <Image src={src} alt={brand.name} width={brand.logo.width} height={brand.logo.height} priority className="h-auto w-auto max-w-full" />
        </NameTag>
      ) : (
        // Text fallback: monogram tile (decorative) + the wordmark, sized to the
        // logo's reserved height so swapping in the real asset shifts nothing.
        <span className="inline-flex items-center gap-3" style={{ minHeight: brand.logo.height }}>
          <span
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-gold bg-ivory font-display text-lg tracking-tight text-gold-deep"
          >
            {brand.monogram}
          </span>
          <NameTag className={`m-0 font-display text-2xl leading-none ${nameColor}`}>{brand.name}</NameTag>
        </span>
      )}
      {showTagline && brand.tagline ? (
        <span className="text-[11px] font-medium uppercase tracking-[0.24em] text-gold-deep">{brand.tagline}</span>
      ) : null}
      {showPoweredBy ? (
        <PoweredByAflo className="text-[11px] font-medium uppercase tracking-[0.28em] text-gold-deep" />
      ) : null}
    </span>
  );
}
