import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from "@cucumber/gherkin";
import { IdGenerator } from "@cucumber/messages";

// UNIT_BOUNDARY_DESCRIPTION: @todo marks a Rule, or a whole capability, that has no examples yet.
export const allowedTags = new Set(["@ui", "@cli", "@api", "@wip", "@real-model", "@journey", "@todo"]);
export const surfaceTags = new Set(["@ui", "@cli", "@api"]);
export const screenWords =
  /\b(click(s|ed|ing)?|tap(s|ped|ping)?|press(es|ed|ing)?|buttons?|fields?|textbox(es)?|dropdowns?|checkbox(es)?|hover(s|ed|ing)?|scroll(s|ed|ing)?|modals?|dialogs?|sidebars?|menus?|icons?)\b/i;

const profiles = {
  example: { maxSteps: 8, maxBackgroundSteps: 5 },
  journey: { maxSteps: 25, maxBackgroundSteps: 5 },
};

function parse(source) {
  const parser = new Parser(new AstBuilder(IdGenerator.uuid()), new GherkinClassicTokenMatcher());
  return parser.parse(source);
}

function kinds(steps) {
  let last = "Given";
  return steps.map((step) => {
    const type = step.keywordType;
    if (type === "Context") last = "Given";
    else if (type === "Action") last = "When";
    else if (type === "Outcome") last = "Then";
    return { step, kind: last, continued: type === "Conjunction" };
  });
}

function tagNames(node) {
  return (node.tags ?? []).map((t) => t.name);
}

export function lintFeature(source, isJourney, names = new Map(), file = "feature") {
  const problems = [];
  const at = (node, message) => problems.push(`${file}:${node.location.line}: ${message}`);
  let document;
  try {
    document = parse(source);
  } catch (error) {
    return [`${file}: does not parse: ${String(error.message ?? error).split("\n")[0]}`];
  }
  const feature = document.feature;
  if (!feature) return [`${file}: has no Feature`];
  const profile = isJourney ? profiles.journey : profiles.example;
  const featureTags = tagNames(feature);
  if (!feature.name.trim()) at(feature, "a Feature needs a name");
  const words = (node, text, what) => {
    const word = text.match(screenWords);
    if (word) at(node, `${what} names the screen ("${word[0]}"): say what the person does, not where`);
  };
  words(feature, `${feature.name} ${feature.description ?? ""}`, "the Feature");
  const tags = (node, list) => {
    for (const tag of list) {
      if (!allowedTags.has(tag)) at(node, `tag ${tag} is not one of ${[...allowedTags].join(" ")}`);
      if (tag === "@journey" && !isJourney) at(node, "@journey belongs to features/journeys/");
    }
  };
  tags(feature, featureTags);
  const featureTodo = featureTags.includes("@todo");
  if (isJourney && featureTodo) at(feature, "a journey is written whole, never left @todo");
  if (isJourney && !featureTags.includes("@journey")) at(feature, "a journey's Feature is tagged @journey");

  const scenario = (node, inherited) => {
    const all = [...inherited, ...tagNames(node)];
    tags(node, tagNames(node));
    for (const table of node.examples ?? []) tags(table, tagNames(table));
    const what = isJourney ? "journey" : "example";
    if (!node.name.trim()) at(node, `an ${what} needs a name`);
    else if (names.has(node.name)) at(node, `"${node.name}" is also the name of ${names.get(node.name)}`);
    else names.set(node.name, `${file}:${node.location.line}`);
    words(node, `${node.name} ${node.description ?? ""}`, `the ${what}'s name`);
    if (isJourney && !all.some((t) => surfaceTags.has(t)))
      at(node, "a journey names its surfaces: @ui, @cli or @api");
    const steps = kinds(node.steps);
    if (steps.length > profile.maxSteps)
      at(node, `${steps.length} steps; an ${what} has at most ${profile.maxSteps}`);
    for (const { step } of steps) words(step, step.text, "a step");
    if (!steps.some((s) => s.kind === "Then")) at(node, `an ${what} ends in a Then`);
    if (isJourney) {
      let started = false;
      for (const { step, kind } of steps) {
        if (kind !== "Given") started = true;
        else if (started) at(step, "a journey's Given steps come first");
      }
      return;
    }
    const order = { Given: 0, When: 1, Then: 2 };
    let previous = 0;
    for (const { step, kind } of steps) {
      if (order[kind] < previous) at(step, `${kind} after ${kind === "Given" ? "When or Then" : "Then"}: Given, When, Then in that order`);
      previous = Math.max(previous, order[kind]);
    }
    const actions = steps.filter((s) => s.kind === "When");
    if (actions.length !== 1)
      at(node, `${actions.length} When steps; an example shows one action, so one When`);
  };

  for (const child of feature.children) {
    if (child.background) {
      const background = child.background;
      if (background.steps.length > profile.maxBackgroundSteps)
        at(background, `a Background has at most ${profile.maxBackgroundSteps} steps`);
      for (const step of background.steps) words(step, step.text, "a step");
    } else if (child.scenario) {
      if (!isJourney) at(child.scenario, "an example sits under a Rule");
      scenario(child.scenario, featureTags);
    } else if (child.rule) {
      const rule = child.rule;
      if (isJourney) at(rule, "a journey is a Scenario of its own, not under a Rule");
      if (!rule.name.trim()) at(rule, "a Rule needs a name");
      words(rule, `${rule.name} ${rule.description ?? ""}`, "the Rule");
      tags(rule, tagNames(rule));
      const examples = rule.children.filter((c) => c.scenario);
      const todo = featureTodo || tagNames(rule).includes("@todo");
      if (examples.length === 0 && !todo)
        at(rule, "a Rule has at least one example, or is marked @todo");
      if (examples.length > 0 && todo)
        at(rule, "a Rule with examples is not @todo: drop the tag, or move it from the Feature to the Rules still without examples");
      for (const ruleChild of rule.children) {
        if (ruleChild.background)
          for (const step of ruleChild.background.steps) words(step, step.text, "a step");
        if (ruleChild.scenario)
          scenario(ruleChild.scenario, [...featureTags, ...tagNames(rule)]);
      }
    }
  }
  return problems;
}

/** UNIT_BOUNDARY_DESCRIPTION: a feature file is one capability, in the folder of its area: features/<area>/<capability>.feature. */
export function placement(parts) {
  if (parts.length !== 2) return "a feature file sits in one area folder, features/<area>/<capability>.feature";
  return null;
}

function featureFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return featureFiles(path);
    return entry.name.endsWith(".feature") ? [path] : [];
  });
}

function main() {
  const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const featuresDir = join(packageDir, "features");
  const journeysDir = join(featuresDir, "journeys") + sep;
  const names = new Map();
  const problems = [];
  const files = featureFiles(featuresDir);
  for (const file of files) {
    const problem = placement(relative(featuresDir, file).split(sep));
    if (problem) problems.push(`${relative(packageDir, file)}: ${problem}`);
  }
  for (const file of files)
    problems.push(
      ...lintFeature(readFileSync(file, "utf8"), file.startsWith(journeysDir), names, relative(packageDir, file)),
    );
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`${files.length} feature files follow the writing rules`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
