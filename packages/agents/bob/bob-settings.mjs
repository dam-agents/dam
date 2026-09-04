#!/usr/bin/env node
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const HOME = process.env.HOME || "/home/agent";
const SETTINGS_PATH = join(HOME, ".bob", "settings", "settings.json");
const RULES_DIR = join(HOME, ".bob", "rules");
const PLATFORM_RULE_PATH = join(RULES_DIR, "platform.md");
const PLATFORM_INSTRUCTIONS = "/etc/AGENTS.md";
const MODES = ["agent", "plan", "ask"];
const LEGACY_MODES = { code: "agent", advanced: "agent" };
const APPROVALS = ["auto", "ask"];
const RETIRED_APPROVAL_KEYS = [
  "autoApprovalEnabled",
  "allowed_permissions",
  "allowedExecutors",
];

function isNonNullObject(value) {
  return typeof value === "object" && value !== null;
}

function normalizeMode(mode) {
  const trimmed = mode?.trim();
  if (!trimmed) return null;
  const mapped = LEGACY_MODES[trimmed] ?? trimmed;
  return MODES.includes(mapped) ? mapped : null;
}

function readExistingSettings() {
  let raw;
  try {
    raw = readFileSync(SETTINGS_PATH, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  const parsed = JSON.parse(raw);
  return isNonNullObject(parsed) && !Array.isArray(parsed) ? parsed : {};
}

function section(existing, key) {
  const value = existing[key];
  return isNonNullObject(value) && !Array.isArray(value) ? { ...value } : {};
}

function firstNonBlank(...values) {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function resolveApprovals(panel) {
  const chosen = firstNonBlank(panel.approvals);
  if (chosen && APPROVALS.includes(chosen)) return chosen;
  return process.env.BOB_AUTO_APPROVE === "0" ? "ask" : "auto";
}

function writeSettings() {
  const existing = readExistingSettings();
  const panel = section(existing, "platform");
  const mode =
    normalizeMode(panel.mode) ?? normalizeMode(process.env.BOB_CHAT_MODE);
  const model = firstNonBlank(process.env.BOB_SHELL_MODEL);
  const cost = Number(
    firstNonBlank(process.env.BOB_MAX_COINS, process.env.BOB_MAX_COST),
  );
  const maxCost = Number.isFinite(cost) && cost > 0 ? cost : null;
  const approval = section(existing, "approval");
  for (const key of RETIRED_APPROVAL_KEYS) delete approval[key];
  const session = section(existing, "session");
  for (const [key, value] of Object.entries({
    defaultMode: mode,
    model,
    maxCost,
  })) {
    if (value === null) delete session[key];
    else session[key] = value;
  }
  const settings = {
    ...existing,
    session,
    approval: { ...approval, outsideWorkspaceAllowed: true },
    bobShell: { ...section(existing, "bobShell"), autoUpdate: false },
  };
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
  process.stdout.write(`${resolveApprovals(panel)}\n`);
}

function platformRuleIsLinked() {
  return (
    lstatSync(PLATFORM_RULE_PATH, {
      throwIfNoEntry: false,
    })?.isSymbolicLink() &&
    readlinkSync(PLATFORM_RULE_PATH) === PLATFORM_INSTRUCTIONS
  );
}

function ensureRules() {
  if (!existsSync(PLATFORM_INSTRUCTIONS)) return;
  mkdirSync(RULES_DIR, { recursive: true });
  if (platformRuleIsLinked()) return;
  rmSync(PLATFORM_RULE_PATH, { force: true });
  try {
    symlinkSync(PLATFORM_INSTRUCTIONS, PLATFORM_RULE_PATH);
  } catch {
    copyFileSync(PLATFORM_INSTRUCTIONS, PLATFORM_RULE_PATH);
  }
}

function run(step, { required }) {
  try {
    step();
  } catch (err) {
    process.stderr.write(`[bob-settings] ${step.name} failed: ${err.message}\n`);
    if (required) process.exitCode = 1;
  }
}

run(writeSettings, { required: true });
run(ensureRules, { required: false });
