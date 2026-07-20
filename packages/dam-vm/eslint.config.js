import base from "dev-config/eslint";

// The shared base targets src/**/*.{ts,tsx}; this package is dependency-light
// `.mjs` at the package root + test/, so lint those with no-unused-vars on
// (a stray import/variable then fails `mise run check`).
export default [
  ...base,
  {
    files: ["*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-unused-vars": "error" },
  },
];
