# @aflo/config

Shared build configuration:

- `tsconfig.base.json` — strict TypeScript defaults every workspace extends.
- `eslint.base.mjs` — flat ESLint config for non-Next.js TypeScript packages (the web app uses `eslint-config-next` directly).

Referenced by relative path from each workspace so configs work without package resolution.
