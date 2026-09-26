import { defineConfig } from "eslint/config";
import unicorn from "eslint-plugin-unicorn";
import tseslint from "typescript-eslint";

export default defineConfig([
  { ignores: ["dist/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [tseslint.configs.base],
    plugins: { unicorn },
    rules: {
      "unicorn/filename-case": [
        "error",
        { case: "kebabCase", directoryRoots: [/(^|\/)__tests__$/] },
      ],
    },
  },
]);
