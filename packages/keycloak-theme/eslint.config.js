import reactHooks from "eslint-plugin-react-hooks";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import tseslint from "typescript-eslint";

import base from "dev-config/eslint";

export default [
  ...base,
  {
    ignores: [
      "src/kc.gen.tsx",
      "dist/**",
      "dist_keycloak/**",
      "public/**",
    ],
  },
  {
    files: [
      "src/login/KcContext.ts",
      "src/login/KcPage.tsx",
      "src/login/pages/**/*.tsx",
      "src/login/Template.tsx",
    ],
    rules: { "unicorn/filename-case": "off" },
  },
  ...tseslint.config({
    files: ["src/**/*.{ts,tsx}"],
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
  }),
];
