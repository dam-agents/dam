// Self-contained flat config (no imports → no devDependencies, so the package
// stays `npm install`-able on the VPS). The shared dev-config base targets
// src/**/*.{ts,tsx} and does nothing for this package's `.mjs`; all we want
// here is no-unused-vars so a stray import/variable fails `mise run check`.
export default [
  {
    files: ["*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-unused-vars": "error" },
  },
];
