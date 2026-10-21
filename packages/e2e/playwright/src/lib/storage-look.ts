import assert from "node:assert/strict";

export interface Room {
  id: string;
  generation: string;
  grantMiB: number;
  availMiB: number;
  stable: boolean;
}

export interface Look {
  id: string;
  generation: string;
  grantMiB: number;
  filledMiB: number;
  stable: boolean;
}

function words(lines: string[], marker: string): string[] {
  return lines
    .filter((line) => line.startsWith(`${marker} `))
    .map((line) => line.slice(marker.length + 1).split(/\s+/)[0] ?? "")
    .map((word) => (word === "-" ? "" : word));
}

function grantMiB(line: string): number {
  const bytes = Number(line.slice(line.lastIndexOf(" ") + 1));
  return Number.isFinite(bytes) && bytes > 0
    ? Math.round(bytes / 1048576)
    : Number.NaN;
}

function kbAfter(lines: string[], marker: string): number {
  const line = lines.find((l) => l.startsWith(marker));
  if (line === undefined) return Number.NaN;
  const kb = Number(line.slice(marker.length));
  return Number.isFinite(kb) ? Math.round(kb / 1024) : Number.NaN;
}

// UNIT_BOUNDARY_DESCRIPTION: one reading of the grant the runner published to a machine, the generation the guard has taken up, and the guest's own free space, from the lines a guest command printed with a `grant` and an `applied` line on both sides of the room. The guard's own generation is what makes the pair safe to compare: the runner publishes a new id at every look and the guard reads that file on a look of its own, so two equal published ids do not say the guard has consumed the grant, and only the guard's file says which generation its room is counted from. A reading whose generation moved belongs to neither generation and no bound compares with it.
export function parseRoom(lines: string[]): Room {
  const published = words(lines, "grant");
  const applied = words(lines, "applied");
  const [first = ""] = published;
  const [generation = ""] = applied;
  const line = lines.find((l) => l.startsWith(`grant ${first} `)) ?? "";
  return {
    id: first,
    generation,
    grantMiB: first ? grantMiB(line) : Number.NaN,
    availMiB: kbAfter(lines, "avail="),
    stable:
      published.length === 2 &&
      applied.length === 2 &&
      first !== "" &&
      generation !== "" &&
      published.every((id) => id === first) &&
      applied.every((gen) => gen === generation),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether a caller may compare a reading's room with its grant: the guard held one generation across the whole reading, that generation is one taken up after `after` rather than the one the case's earlier writes ran into, and the reading reported both figures. Every part is required together, because a reading that fails any one of them is a room of unknown age and no bound compares with it.
export function judged(room: Room, after: string): boolean {
  return (
    room.stable &&
    room.generation !== after &&
    Number.isFinite(room.grantMiB) &&
    Number.isFinite(room.availMiB)
  );
}

// UNIT_BOUNDARY_DESCRIPTION: one look at a machine's home across a fill and the write that follows it, from the lines a guest command printed: a `grant` and an `applied` line before the fill, after it, and after the probe, and the guest's room after the fill. The applied line is the guard's own generation and not the runner's published id, which is the whole point: an id the guard has not consumed yet reads the same on the runner's side while the guard is still counting from an older grant, so a look bracketed on the published id alone would judge a renewal it never saw. The generation is the discriminator for whether the look is usable at all, and a look whose generation moved was one a renewal reached and is thrown away rather than judged.
export function parseLook(lines: string[]): Look {
  const published = words(lines, "grant");
  const applied = words(lines, "applied");
  const [first = ""] = published;
  const [generation = ""] = applied;
  const line = lines.find((l) => l.startsWith(`grant ${first} `)) ?? "";
  return {
    id: first,
    generation,
    grantMiB: first ? grantMiB(line) : Number.NaN,
    filledMiB: kbAfter(lines, "avail-after-fill="),
    stable:
      published.length === 3 &&
      applied.length === 3 &&
      first !== "" &&
      generation !== "" &&
      published.every((id) => id === first) &&
      applied.every((gen) => gen === generation),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether the case may judge a look: the guard held one generation across the fill and the probe, that generation is one taken up after `after`, the look reported its figures, and the fill really left the guest less room than the probe asks for. The last bound is the probe's own size and not a constant about the guard: it says the fill reached the share, since a guest with `probeMiB` or more left is a guest the probe could be allowed to write as a matter of arithmetic and no refusal of it is evidence of anything. A bound read from the guard's floor would be wrong in both directions once the allowance is smaller than the floor plus slack, which a claim divided among many machines makes ordinary. A look is deliberately judged here on the guard's generation and the fill alone, never on what the probe did: within one generation any room the guard gives back is the defect the case is for, so a marked probe under a stable generation returns from the caller's loop and fails its `probe=refused` check instead of being retried into a pass. Only a look a renewal reached is retaken.
export function judgeable(
  look: Look,
  after: string,
  probeMiB: number,
): boolean {
  return (
    look.stable &&
    look.generation !== after &&
    Number.isFinite(look.grantMiB) &&
    Number.isFinite(look.filledMiB) &&
    look.filledMiB < probeMiB
  );
}

if (import.meta.main) {
  const shared = (mib: number) => mib * 1048576;
  const grant = (id: string, mib: number) => `grant ${id} ${shared(mib)}`;
  const applied = (generation: string) => `applied ${generation}`;
  const PROBE = 64;

  const room = parseRoom([
    grant("7", 20_000),
    applied("7"),
    "avail=10240",
    grant("7", 20_000),
    applied("7"),
  ]);
  assert.equal(room.stable, true);
  assert.equal(room.generation, "7");
  assert.equal(room.grantMiB, 20000);
  assert.equal(room.availMiB, 10);
  assert.equal(judged(room, "6"), true);
  assert.equal(judged(room, "7"), false);

  // TEST_SCENARIO: the runner published a new id while the guard still holds the old generation, so the published lines agree and the guard's do not. The room is the old generation's and no bound compares with it.
  const behind = parseRoom([
    grant("8", 20_000),
    applied("7"),
    "avail=10240",
    grant("8", 20_000),
    applied("8"),
  ]);
  assert.equal(behind.stable, false);
  assert.equal(judged(behind, "6"), false);

  // TEST_SCENARIO: the guest was held by no grant at all, which is no generation to compare a room with.
  const absent = parseRoom([
    "grant -",
    "applied -",
    "avail=10240",
    "grant -",
    "applied -",
  ]);
  assert.equal(Number.isFinite(absent.grantMiB), false);
  assert.equal(judged(absent, "6"), false);

  // TEST_SCENARIO: a reading that printed no room fails rather than passing a figure.
  const blindRoom = parseRoom([
    grant("9", 100),
    applied("9"),
    grant("9", 100),
    applied("9"),
  ]);
  assert.equal(Number.isFinite(blindRoom.availMiB), false);
  assert.equal(judged(blindRoom, "6"), false);

  const look = (grantIds: string[], generations: string[], filled: number) =>
    parseLook([
      grant(grantIds[0], 20_000),
      applied(generations[0]),
      `avail-after-fill=${filled * 1024}`,
      grant(grantIds[1], 20_000),
      applied(generations[1]),
      "probe=refused",
      "No space left on device",
      grant(grantIds[2], 20_000),
      applied(generations[2]),
    ]);

  const held = look(["7", "7", "7"], ["7", "7", "7"], 10);
  assert.equal(held.stable, true);
  assert.equal(held.generation, "7");
  assert.equal(held.filledMiB, 10);
  assert.equal(judgeable(held, "6", PROBE), true);
  assert.equal(judgeable(held, "7", PROBE), false);

  // TEST_SCENARIO: the guard took up a new generation during the fill, so the room the fill marked was given back by design and the look says nothing. It is retaken.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["7", "8", "8"], 10), "6", PROBE),
    false,
  );

  // TEST_SCENARIO: the guard took up a new generation during the probe, which is the delayed consumption a small allowance makes ordinary. Retaken, and never reported as a refusal the product failed to make.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["8", "8", "9"], 10), "6", PROBE),
    false,
  );

  // TEST_SCENARIO: the runner republished while the guard held one generation. The published id is not what the case judges, and the generation never moved inside the look, so the refusal it read is the product's answer.
  assert.equal(
    judgeable(look(["8", "9", "9"], ["8", "8", "8"], 10), "6", PROBE),
    false,
  );

  // TEST_SCENARIO: one generation throughout and the write was allowed anyway. This is the defect the case is for, so the look is judgeable and the caller's `probe=refused` check fails it: it must never be retried into a pass.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["8", "8", "8"], 10), "6", PROBE),
    true,
  );

  // TEST_SCENARIO: the fill never reached the share, so the look proves nothing about the write. Judged on the filled room alone, with a low reading after the probe, so the filled bound is the one that rejects it.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["8", "8", "8"], 3840), "6", PROBE),
    false,
  );

  // TEST_SCENARIO: a guard that releases room under the generation it already held is the defect the case exists for, and the look must be judged rather than retaken: retaking it would hide an intermittent release behind a pass the next attempt earns. The probe succeeded here, so returning this look fails the caller's `probe=refused` check.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["8", "8", "8"], 10), "6", PROBE),
    true,
  );

  // TEST_SCENARIO: a small allowance the guard took up only after the fill is an ordinary healthy renewal, and a bound read from the guard's floor would call its 236 MiB after a successful probe a release. The generation moved, so the look is retaken and never reported against the product.
  assert.equal(
    judgeable(look(["8", "8", "8"], ["7", "8", "8"], 10), "6", PROBE),
    false,
  );

  // TEST_SCENARIO: a generation the case's own writes ran into is not one taken up after them.
  assert.equal(judgeable(held, "7", PROBE), false);

  // TEST_SCENARIO: a look with no generation at all is no evidence.
  const absentLook = parseLook([
    "grant -",
    "applied -",
    "avail-after-fill=10240",
    "grant -",
    "applied -",
    "grant -",
    "applied -",
  ]);
  assert.equal(Number.isFinite(absentLook.grantMiB), false);
  assert.equal(judgeable(absentLook, "6", PROBE), false);

  // TEST_SCENARIO: a look that printed no room at all fails rather than passing a figure.
  const blindLook = parseLook([
    grant("9", 100),
    applied("9"),
    grant("9", 100),
    applied("9"),
    grant("9", 100),
    applied("9"),
  ]);
  assert.equal(Number.isFinite(blindLook.filledMiB), false);
  assert.equal(judgeable(blindLook, "6", PROBE), false);

  console.log("storage-look self-check OK");
}
