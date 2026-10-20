import assert from "node:assert/strict";

export interface Look {
  id: string;
  grantMiB: number;
  availMiB: number;
  stable: boolean;
}

// UNIT_BOUNDARY_DESCRIPTION: one look at a machine's home and the storage grant the runner published for it, picked out of the lines a guest command printed: the first and last `grant` lines and the `avail=` line. The two grant lines agree only when no renewal was published while the look ran. A renewal changes what the guard holds, because the guard counts a grant from what the guest had written when it came, so a room read across one says nothing about the room the case measured before it. The window between the two lines is the case's own writes, which take seconds, and the runner republishes every 30 s, so a look that straddles one is common and is thrown away rather than judged either way. A missing grant file prints `grant -`, which parses as no id and so as an unstable look with no grant, never as a grant id of its own: an unmeasured claim then reads as NaN and fails its caller's check instead of passing a figure the guest never had.
export function parseLook(lines: string[]): Look {
  const grants = lines.filter((line) => line.startsWith("grant "));
  const [first = "", last = ""] = [grants.at(0) ?? "", grants.at(-1) ?? ""];
  const [rawId = "", bytes = ""] = first.slice("grant ".length).split(/\s+/);
  const [rawLastId = ""] = last.slice("grant ".length).split(/\s+/);
  const id = rawId === "-" ? "" : rawId;
  const lastId = rawLastId === "-" ? "" : rawLastId;
  const mib = Number(bytes) / 1048576;
  const availKb = Number(
    /^avail=(\d+)/.exec(
      lines.find((line) => line.startsWith("avail=")) ?? "",
    )?.[1] ?? Number.NaN,
  );
  return {
    id,
    grantMiB: bytes && Number.isFinite(mib) ? Math.round(mib) : Number.NaN,
    availMiB: Math.round(availKb / 1024),
    stable: id === lastId && id !== "",
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether the case may judge a look: it was read inside one grant, that grant is one the runner published after `after` rather than the one the case's earlier writes ran into, and it reported the guest's room. Every part is required together, because a look that fails any one of them is a room of unknown age and no bound compares with it.
export function judgeable(look: Look, after: string): boolean {
  return look.stable && look.id !== after && Number.isFinite(look.availMiB);
}

if (import.meta.main) {
  const grant = (id: string, mib: number) => `grant ${id} ${mib * 1048576}`;
  const fill = ["fill=chunked", "probe=refused", "No space left on device"];

  const oneGrant = parseLook([
    grant("7", 20_000),
    ...fill,
    "avail=10240",
    grant("7", 20_000),
  ]);
  assert.equal(oneGrant.stable, true);
  assert.equal(oneGrant.id, "7");
  assert.equal(oneGrant.grantMiB, 20000);
  assert.equal(oneGrant.availMiB, 10);
  assert.equal(judgeable(oneGrant, "6"), true);

  // TEST_SCENARIO: a renewal lands between the case's fill and its probe, so the look straddles one. Its probe line may read either way and means nothing.
  const straddled = parseLook([
    grant("7", 20_000),
    ...fill,
    "probe=marked",
    "avail=10240",
    grant("8", 20_000),
  ]);
  assert.equal(straddled.stable, false);
  assert.equal(judgeable(straddled, "6"), false);

  // TEST_SCENARIO: a look whose grant is the one the case's own writes ran into is not a renewal.
  assert.equal(judgeable(oneGrant, "7"), false);

  // TEST_SCENARIO: an absent grant file is no grant, not the `df` row standing in for one.
  const absent = parseLook(["grant -", "avail=10240", "grant -"]);
  assert.equal(Number.isFinite(absent.grantMiB), false);
  assert.equal(judgeable(absent, "6"), false);

  // TEST_SCENARIO: a look that printed no room at all fails rather than passing a figure.
  const blind = parseLook([grant("9", 100), "fill=whole", grant("9", 100)]);
  assert.equal(Number.isFinite(blind.availMiB), false);
  assert.equal(judgeable(blind, "6"), false);

  console.log("storage-look self-check OK");
}
