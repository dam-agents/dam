import { TinySearch, tokenize } from "../src/tiny-search.js";

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = (
  "the of and to in is that it for on with as at by from up about into over " +
  "after data cache index query search node system time value key store read " +
  "write fast slow test bench result score latency memory disk network user " +
  "request response server client token text word list array map set tree " +
  "graph queue stack heap sort scan filter merge split parse build run start " +
  "stop error retry limit count total mean median percent second minute hour " +
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima " +
  "mike november oscar papa quebec romeo sierra tango uniform victor whiskey " +
  "xray yankee zulu apple banana cherry grape lemon mango olive peach plum " +
  "quince raisin walnut engine wheel spring bolt gear lever piston valve"
).split(/\s+/);

const VERIFY_EVERY = 16;

function pickWord(rand) {
  const r = rand();
  return WORDS[Math.floor(r * r * WORDS.length)];
}

function makeDoc(rand) {
  const length = 30 + Math.floor(rand() * 50);
  const words = new Array(length);
  for (let i = 0; i < length; i += 1) words[i] = pickWord(rand);
  return words.join(" ");
}

function makeQuery(rand) {
  const terms = rand() < 0.6 ? 1 : 2;
  const words = new Array(terms);
  for (let i = 0; i < terms; i += 1) words[i] = pickWord(rand);
  return words.join(" ");
}

function foldChecksum(checksum, results) {
  let h = checksum;
  for (const { id, score } of results) {
    for (let i = 0; i < id.length; i += 1) {
      h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
    }
    h = (Math.imul(h, 31) + score) | 0;
  }
  return h;
}

function percentileUs(sortedNs, p) {
  const rank = Math.ceil((p / 100) * sortedNs.length);
  const index = Math.min(sortedNs.length - 1, Math.max(0, rank - 1));
  return Number(sortedNs[index]) / 1000;
}

function boundedInt(key, raw, min) {
  if (raw === undefined) throw new Error(`--${key} needs a value`);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`--${key} must be an integer >= ${min}, got: ${raw}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = { scenario: "query-heavy", n: 5000, ops: 400, seed: 1 };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, "");
    const value = argv[i + 1];
    if (key === "scenario") {
      if (value === undefined) throw new Error("--scenario needs a value");
      args.scenario = value;
    } else if (key === "n" || key === "ops") {
      args[key] = boundedInt(key, value, 1);
    } else if (key === "seed") {
      args[key] = boundedInt(key, value, 0);
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!["query-heavy", "index-heavy", "mixed"].includes(args.scenario)) {
    throw new Error(`unknown scenario: ${args.scenario}`);
  }
  return args;
}

const { scenario, n, ops, seed } = parseArgs(process.argv);
const rand = mulberry32(seed);
const index = new TinySearch();

const buildStart = process.hrtime.bigint();
for (let i = 0; i < n; i += 1) {
  index.add(`doc-${String(i).padStart(6, "0")}`, makeDoc(rand));
}
const buildMs = Number(process.hrtime.bigint() - buildStart) / 1e6;

const samplesNs = [];
let checksum = 0;

for (let i = 0; i < ops; i += 1) {
  const isQuery =
    scenario === "query-heavy" ||
    (scenario === "mixed" && rand() < 0.8);

  if (isQuery) {
    const query = makeQuery(rand);
    const start = process.hrtime.bigint();
    const results = index.search(query);
    samplesNs.push(process.hrtime.bigint() - start);
    checksum = foldChecksum(checksum, results);
  } else {
    const id = `doc-${String(Math.floor(rand() * n)).padStart(6, "0")}`;
    const text = makeDoc(rand);
    const start = process.hrtime.bigint();
    index.add(id, text);
    samplesNs.push(process.hrtime.bigint() - start);
    checksum = (Math.imul(checksum, 31) + index.size) | 0;
    if (i % VERIFY_EVERY === 0) {
      checksum = foldChecksum(
        checksum,
        index.search(tokenize(text)[0] ?? "", { limit: 3 }),
      );
    }
  }
}

samplesNs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const totalNs = samplesNs.reduce((sum, v) => sum + v, 0n);
const meanUs = Number(totalNs) / samplesNs.length / 1000;

console.log(
  JSON.stringify({
    scenario,
    n,
    ops,
    seed,
    p50_us: Number(percentileUs(samplesNs, 50).toFixed(3)),
    p95_us: Number(percentileUs(samplesNs, 95).toFixed(3)),
    mean_us: Number(meanUs.toFixed(3)),
    ops_per_sec: Math.round(samplesNs.length / (Number(totalNs) / 1e9)),
    build_ms: Number(buildMs.toFixed(1)),
    checksum,
  }),
);
