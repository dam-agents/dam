export default [
  {
    files: ["*.mjs", "test/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-unused-vars": "error" },
  },
];
