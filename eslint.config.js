import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default tseslint.config([
  {
    ignores: [".claude/worktrees/**", ".worktrees/**", "context/**", "**/proto-gen/**"],
  },
  {
    files: ["packages/**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    plugins: { unicorn },
    rules: {
      "unicorn/filename-case": ["error", { case: "kebabCase" }],
    },
  },
  // Full rule set only for already-migrated UI code. Legacy files inherit
  // only the base rules above. Files automatically adopt the strict rules
  // when they move into modules/ during the refactor. Once every domain is
  // done, drop this block and widen the rules above to packages/ui/**.
  {
    files: ["packages/ui/src/modules/**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    plugins: {
      "simple-import-sort": simpleImportSort,
      "react-hooks": reactHooks,
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
]);
