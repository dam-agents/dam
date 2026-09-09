import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { LoadSample } from "./client.js";

export interface SampleRow {
  env: string;
  agentId: string;
  label: string;
  mode: "cold" | "warm";
  sample: LoadSample;
}

export function appendSample(file: string, row: SampleRow): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(row)}\n`);
}

export function readSamples(file: string): SampleRow[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as SampleRow);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] ?? NaN;
}

function fmt(ms: number): string {
  if (Number.isNaN(ms)) return "-";
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
}

export function summarize(rows: SampleRow[]): string {
  const groups = new Map<string, SampleRow[]>();
  for (const row of rows) {
    const key = `${row.env}|${row.label}|${row.mode}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const lines: string[] = [];
  lines.push(
    "| env | conversation | mode | n | events | bytes | connect p50 | ttfe p50/p95 | replay p50/p95 | total p50/p95 |",
  );
  lines.push(
    "|-----|--------------|------|---|--------|-------|-------------|--------------|----------------|---------------|",
  );
  const keys = [...groups.keys()].sort();
  for (const key of keys) {
    const group = groups.get(key) ?? [];
    const [env, label, mode] = key.split("|");
    const of = (pick: (s: LoadSample) => number): number[] =>
      group.map((r) => pick(r.sample)).sort((a, b) => a - b);
    const connect = of((s) => s.phases.wsOpenMs + s.phases.initializeMs);
    const ttfe = of((s) => s.phases.firstEventMs);
    const replay = of((s) => s.phases.responseMs - s.phases.firstEventMs);
    const total = of((s) => s.phases.responseMs);
    const events = of((s) => s.events);
    const bytes = of((s) => s.eventBytes);
    const truncated = group.some((r) => r.sample.truncated) ? " (clipped)" : "";
    lines.push(
      `| ${env} | ${label}${truncated} | ${mode} | ${group.length} | ${Math.round(percentile(events, 50))} | ${Math.round(percentile(bytes, 50) / 1024)}KB | ${fmt(percentile(connect, 50))} | ${fmt(percentile(ttfe, 50))} / ${fmt(percentile(ttfe, 95))} | ${fmt(percentile(replay, 50))} / ${fmt(percentile(replay, 95))} | ${fmt(percentile(total, 50))} / ${fmt(percentile(total, 95))} |`,
    );
  }
  return lines.join("\n");
}
