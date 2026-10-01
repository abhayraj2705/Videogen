// Shared flat config for the Node side of the monorepo (backend, worker,
// packages/*). apps/web keeps its own Next.js config (apps/web/eslint.config.mjs).
// Deliberately non-type-aware: fast, and it only gates real mistakes.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/.data/**",
      "**/out/**",
      "apps/web/**",
      "packages/db/migrations/**",
      "**/*.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-empty-object-type": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
