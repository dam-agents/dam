#!/usr/bin/env node
import { TinyCache } from "../src/tiny-cache.js";

function parseArgs(argv) {
  const out = { scenario: "read-heavy", n: 20000, ops: 5000, seed: 1 };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, "");
    const value = argv[i + 1];
    if (key === "scenario") out.scenario = value;
    else if (key === "n" || key === "ops" || key === "seed") out[key] = Number(value);
    else {
      console.error(`unknown flag: ${argv[i]}`);
      process.exit(2);
    }
  }
  return out;
}

function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

function percentile(sortedUs, p) {
  const i = Math.min(sortedUs.length - 1, Math.floor((p / 100) * sortedUs.length));
  return sortedUs[i];
}

const { scenario, n, ops, seed } = parseArgs(process.argv);
const rng = makeRng(seed);
const cache = new TinyCache();

for (let i = 0; i < n; i++) cache.set(`key-${i}`, { i });

const existingKey = () => `key-${Math.floor(rng() * n)}`;
const freshKey = (i) => `key-new-${seed}-${i}`;

const opForIndex = (i) => {
  if (scenario === "read-heavy") return "get";
  if (scenario === "write-heavy") return "set";
  return rng() < 0.8 ? "get" : "set";
};

for (let i = 0; i < 200; i++) cache.get(existingKey());

const samplesUs = new Array(ops);
const runStart = process.hrtime.bigint();
for (let i = 0; i < ops; i++) {
  const op = opForIndex(i);
  const start = process.hrtime.bigint();
  if (op === "get") cache.get(existingKey());
  else cache.set(rng() < 0.5 ? existingKey() : freshKey(i), { i });
  samplesUs[i] = Number(process.hrtime.bigint() - start) / 1000;
}
const totalS = Number(process.hrtime.bigint() - runStart) / 1e9;

samplesUs.sort((a, b) => a - b);
const mean = samplesUs.reduce((a, b) => a + b, 0) / samplesUs.length;

console.log(
  JSON.stringify({
    scenario,
    n,
    ops,
    seed,
    p50_us: Number(percentile(samplesUs, 50).toFixed(3)),
    p95_us: Number(percentile(samplesUs, 95).toFixed(3)),
    mean_us: Number(mean.toFixed(3)),
    ops_per_sec: Math.round(ops / totalS),
  }),
);
