import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";


/** How far past the median number of Rules a capability may grow before the report flags it. */
export const skewFactor = 3;


/** One capability's row: its area, its name, its Rules and Examples, and how many Rules still wait for examples. */
export function capabilityOf(area, capability, source) {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  const feature = parser.parse(source).feature;
  const row = { area, capability, title: feature.name, rules: 0, examples: 0, todo: 0 };
  for (const child of feature.children) {
    if (child.scenario) row.examples += Math.max(1, ...(child.scenario.examples ?? []).map((t) => t.tableBody.length));
    if (!child.rule) continue;
    row.rules += 1;
    const examples = child.rule.children.filter((c) => c.scenario);
    row.examples += examples.length;
    if (examples.length === 0) row.todo += 1;
  }
  return row;
}

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Each row with a note: a capability with no example yet, or one whose Rules outgrow the median of the capabilities that have examples by more than skewFactor. Journeys cross capabilities and are not counted as one. */
export function report(rows) {
  const capabilities = rows.filter((r) => r.area !== "journeys");
  const typical = median(capabilities.filter((r) => r.examples > 0).map((r) => r.rules));
  return capabilities.map((row) => {
    let note = "";
    if (row.examples === 0) note = "todo";
    else if (row.rules > skewFactor * typical)
      note = `${(row.rules / typical).toFixed(1)}× the median of ${count(typical, "Rule")}`;
    else if (row.todo > 0) note = `${count(row.todo, "Rule")} todo`;
    return { ...row, note };
  });
}

function featureFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return featureFiles(path);
    return entry.name.endsWith(".feature") ? [path] : [];
  });
}

function main() {
  const featuresDir = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "features");
  const rows = featureFiles(featuresDir).map((file) => {
    const [area, name] = relative(featuresDir, file).split(sep);
    return capabilityOf(area, name.replace(/\.feature$/, ""), readFileSync(file, "utf8"));
  });
  const lines = report(rows).sort((a, b) => a.area.localeCompare(b.area) || a.capability.localeCompare(b.capability));
  let area = "";
  for (const row of lines) {
    if (row.area !== area) console.log(`${(area = row.area)}/`);
    const counts = `${count(row.rules, "Rule").padEnd(10)}${row.examples === 0 ? "" : count(row.examples, "Example")}`;
    console.log(`  ${row.capability.padEnd(24)}${counts.padEnd(24)}${row.note}`);
  }
  const covered = lines.filter((r) => r.examples > 0).length;
  console.log(`\n${covered} of ${lines.length} capabilities have examples; ${lines.length - covered} are todo`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
