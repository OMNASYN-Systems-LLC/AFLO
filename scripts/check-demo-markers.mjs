#!/usr/bin/env node
/**
 * Demo-identity marker guard (founder directive PHASE 6).
 *
 * Enforces the non-negotiable rule mechanically: outside automated tests, ΛFLO
 * must never use demo/mock/synthetic IDENTITY. This scans production runtime
 * source for demo-identity/session markers and FAILS CI when a NEW one appears.
 *
 * It is a static complement to the runtime contract (ADR-0017), which already
 * fails closed at BOOT in production. This stops demo auth from proliferating
 * into new code between now and the Clerk swap.
 *
 * Scope: apps/<app>/src and packages/<pkg>/src. Test files are exempt (demo
 * identities are allowed in tests). The ALLOWLIST below names the KNOWN demo
 * runtime path that exists today; it must shrink to empty when Clerk activates.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Precise demo-identity / demo-session markers (not generic words like "hardcoded"). */
const MARKERS = [
  /\bDemoAuthProvider\b/,
  /["'`]demo-user["'`]/,
  /["'`]demo-client["'`]/,
  /["'`]portal-demo-client["'`]/,
  /["'`]mock-session["'`]/,
  /["'`]synthetic-session["'`]/,
  /["'`]demo-staff["'`]/,
  /["'`]demo-org["'`]/,
];

/**
 * The known, tracked demo runtime path (the ONLY place demo identity is allowed
 * in runtime code today). Remove each entry when Clerk replaces it. A new demo
 * marker anywhere NOT listed here fails the build.
 *
 * ADR-0052 shrank this from two entries to one: the `DemoAuthProvider` class
 * AND its construction now live entirely in `packages/auth/src/demo.ts`
 * (via `createDemoAuthProvider`), so `apps/web/src/lib/data.ts` no longer names
 * any demo-identity marker and left the allowlist. `data.ts` is now under FULL
 * guard coverage again — reintroducing a demo marker there fails the build. The
 * one remaining entry drains to zero when the Clerk-backed provider replaces
 * the class (runbook §5.2).
 */
const ALLOWLIST = new Set([
  "packages/auth/src/demo.ts", // the DemoAuthProvider class + its sole factory (prototype auth)
]);

const SCAN_DIRS = ["apps", "packages"];
const CODE_EXT = /\.(ts|tsx|mts|cts)$/;
const TEST_FILE = /(\.test\.|\.spec\.|[/\\](test|tests|__tests__|e2e)[/\\])/;
const SKIP_DIR = /(^|[/\\])(node_modules|dist|\.next|coverage|build)([/\\]|$)/;

/** Collect candidate source files under a directory (only `src/`, skipping tests/builds). */
function collect(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (SKIP_DIR.test(full)) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      collect(full, out);
    } else if (CODE_EXT.test(name) && /[/\\]src[/\\]/.test(full) && !TEST_FILE.test(full)) {
      out.push(full);
    }
  }
}

const files = [];
for (const top of SCAN_DIRS) collect(join(ROOT, top), files);

const violations = [];
for (const file of files) {
  const rel = relative(ROOT, file).split("\\").join("/");
  if (ALLOWLIST.has(rel)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const marker of MARKERS) {
      if (marker.test(line)) {
        violations.push({ rel, line: i + 1, text: line.trim(), marker: marker.source });
      }
    }
  });
}

// Transparency: report what is scanned and what is allowlisted (no silent skips).
console.log(`[demo-marker-guard] scanned ${files.length} runtime source files under ${SCAN_DIRS.join(", ")}/*/src`);
console.log(`[demo-marker-guard] allowlisted known demo runtime paths (must reach 0 when Clerk activates):`);
for (const a of ALLOWLIST) console.log(`  - ${a}`);

if (violations.length > 0) {
  console.error(`\n[demo-marker-guard] FAIL — ${violations.length} demo-identity marker(s) in production runtime code:`);
  for (const v of violations) {
    console.error(`  ${v.rel}:${v.line}  /${v.marker}/  →  ${v.text}`);
  }
  console.error(
    `\nDemo identities are allowed only in automated tests. If this is a genuine, temporary\n` +
      `prototype path, add it to the ALLOWLIST in scripts/check-demo-markers.mjs with a comment\n` +
      `and a removal plan — do not introduce a new silent runtime demo identity.`,
  );
  process.exit(1);
}

console.log(`[demo-marker-guard] OK — no new demo-identity markers in production runtime code.`);
