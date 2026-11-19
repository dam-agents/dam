import { readFileSync } from "node:fs";

const allowed = new Set([
  "@playwright/test",
  "@trpc/client",
  "@trpc/server",
  "api-server-api",
  "playwright-bdd",
  "@types/node",
  "dev-config",
  "typescript",
]);

const manifest = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
const declared = Object.keys({
  ...manifest.dependencies,
  ...manifest.devDependencies,
  ...manifest.peerDependencies,
  ...manifest.optionalDependencies,
});
const extra = declared.filter((name) => !allowed.has(name));
if (extra.length > 0) {
  console.error(
    `e2e-acceptance may depend only on the public API contract and its test tools; remove: ${extra.join(", ")}`,
  );
  process.exit(1);
}
console.log(`e2e-acceptance depends on ${declared.length} allowed packages`);
