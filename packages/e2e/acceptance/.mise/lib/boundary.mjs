import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const allowed = new Set([
  "@cucumber/gherkin",
  "@cucumber/messages",
  "@playwright/test",
  "@trpc/client",
  "@trpc/server",
  "api-server-api",
  "playwright-bdd",
  "@types/node",
  "dev-config",
  "typescript",
]);

const literal = String.raw`\s*(["'\x60])([^"'\x60]*)\1`;

const forms = [
  ["from", new RegExp(String.raw`\bfrom${literal}`, "g")],
  ["side-effect import", new RegExp(String.raw`\bimport${literal}`, "g")],
  ["dynamic import", new RegExp(String.raw`\bimport\s*\(${literal}\s*\)`, "g")],
  ["require", new RegExp(String.raw`\brequire\s*\(${literal}\s*\)`, "g")],
  [
    "import.meta.resolve",
    new RegExp(String.raw`\bimport\.meta\.resolve\s*\(${literal}`, "g"),
  ],
  [
    "reference path",
    new RegExp(String.raw`///\s*<reference\s+path\s*=${literal}`, "g"),
  ],
];

const unverifiable = [
  ["dynamic import of a computed specifier", /\bimport\s*\(\s*(?!["'`][^"'`$]*["'`]\s*\))/g],
  ["require of a computed specifier", /\brequire\s*\(\s*(?!["'][^"']*["']\s*\))/g],
  ["template specifier with an expression", /\b(?:from|import)\s*\(?\s*`[^`]*\$\{/g],
];

export function packageName(specifier) {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

export function violations(file, source, packageDir, names = allowed) {
  const found = [];
  for (const [kind, pattern] of forms)
    for (const match of source.matchAll(pattern)) {
      const specifier = match[2];
      if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const target = resolve(dirname(file), specifier);
        const inside = relative(packageDir, target);
        if (inside === "" || inside.startsWith("..") || inside.startsWith(sep))
          found.push(`${kind} "${specifier}" leaves the package`);
      } else if (specifier.startsWith("node:")) {
        continue;
      } else if (!names.has(packageName(specifier))) {
        found.push(`${kind} "${specifier}" is not an allowed dependency`);
      }
    }
  for (const [kind, pattern] of unverifiable)
    if (pattern.test(source)) found.push(`${kind} cannot be checked`);
  return found;
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name) ? [path] : [];
  });
}

function main() {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const manifest = JSON.parse(
    readFileSync(join(packageDir, "package.json"), "utf8"),
  );
  const declared = Object.keys({
    ...manifest.dependencies,
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });
  const problems = declared
    .filter((name) => !allowed.has(name))
    .map((name) => `package.json: ${name} is not an allowed dependency`);
  const files = [
    ...sourceFiles(join(packageDir, "src")),
    join(packageDir, "playwright.config.ts"),
  ];
  for (const file of files)
    for (const problem of violations(file, readFileSync(file, "utf8"), packageDir))
      problems.push(`${relative(packageDir, file)}: ${problem}`);
  if (problems.length > 0) {
    console.error(
      `e2e-acceptance may reach only its own files, node built-ins and its allowed dependencies:\n${problems.join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `e2e-acceptance: ${declared.length} allowed dependencies, ${files.length} files import nothing outside the package`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
