import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Shared flat config for non-Next.js TypeScript packages (rules, ai, shared, worker). */
export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["node_modules/**", "dist/**"],
  },
);
