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
  try {
    return JSON.parse(readFileSync(SETTINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeSettings() {
  const existing = readExistingSettings();
  const mode = normalizeMode(process.env.BOB_CHAT_MODE);
  const model = process.env.BOB_SHELL_MODEL?.trim();
  const maxCost = Number(process.env.BOB_MAX_COINS ?? process.env.BOB_MAX_COST);
  const settings = {
    ...existing,
    session: {
      ...(isNonNullObject(existing.session) ? existing.session : {}),
      ...(mode ? { defaultMode: mode } : {}),
      ...(model ? { model } : {}),
      ...(Number.isFinite(maxCost) && maxCost > 0 ? { maxCost } : {}),
    },
    approval: {
      ...(isNonNullObject(existing.approval) ? existing.approval : {}),
      outsideWorkspaceAllowed: true,
    },
    bobShell: {
      ...(isNonNullObject(existing.bobShell) ? existing.bobShell : {}),
      autoUpdate: false,
    },
  };
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true });
  writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + "\n");
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
  try {
    if (!existsSync(PLATFORM_INSTRUCTIONS)) return;
    mkdirSync(RULES_DIR, { recursive: true });
    if (platformRuleIsLinked()) return;
    rmSync(PLATFORM_RULE_PATH, { force: true });
    try {
      symlinkSync(PLATFORM_INSTRUCTIONS, PLATFORM_RULE_PATH);
    } catch {
      copyFileSync(PLATFORM_INSTRUCTIONS, PLATFORM_RULE_PATH);
    }
  } catch (err) {
    process.stderr.write(
      `[bob-settings] rules bootstrap failed: ${err.message}\n`,
    );
  }
}

writeSettings();
ensureRules();
