import assert from "node:assert/strict";

export interface Room {
  id: string;
  grantMiB: number;
  availMiB: number;
  stable: boolean;
}

export interface Look {
  id: string;
  grantMiB: number;
  filledMiB: number;
  afterProbeMiB: number;
  grantStable: boolean;
}

function ids(lines: string[]): string[] {
  return lines
    .filter((line) => line.startsWith("grant "))
    .map((line) => line.slice("grant ".length).split(/\s+/)[0] ?? "")
    .map((id) => (id === "-" ? "" : id));
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

// UNIT_BOUNDARY_DESCRIPTION: one reading of the grant the runner published to a machine and the guest's own free space, from the lines a guest command printed with a `grant` line on both sides of the room. The two grant lines agree only when no renewal was published while the reading ran, and a reading that straddles one is not one a caller may compare a room with. The guest's free space is what the guard leaves it, so it is the guard's own answer and not a figure the case works out for itself.
export function parseRoom(lines: string[]): Room {
  const [first = "", last = ""] = ids(lines);
  const line = lines.find((l) => l.startsWith(`grant ${first} `)) ?? "";
  return {
    id: first,
    grantMiB: first ? grantMiB(line) : Number.NaN,
    availMiB: kbAfter(lines, "avail="),
    stable: first !== "" && first === last,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether a caller may compare a reading's room with its grant: it was read inside one published grant, that grant is one published after `after` rather than the one the case's earlier writes ran into, and it reported both figures. Every part is required together, because a reading that fails any one of them is a room of unknown age and no bound compares with it.
export function judged(room: Room, after: string): boolean {
  return (
    room.stable &&
    room.id !== after &&
    Number.isFinite(room.grantMiB) &&
    Number.isFinite(room.availMiB)
  );
}

// UNIT_BOUNDARY_DESCRIPTION: one look at a machine's home across a fill and the write that follows it, from the lines a guest command printed: three `grant` lines bracketing the fill and the probe, the guest's room after the fill, and its room after the probe. The grant lines are what the runner published, not what the guard applied, and the guard reads that file on its own two-second look: an id can print unchanged on all three lines while the guard has not yet consumed it, and then counts a whole fresh grant from the bytes the guest had written when it came and gives the fill's room back. So a published id alone cannot say a look is safe to judge. The guest's own room is the guard's own answer, and it is read on both sides of the probe: a guard that consumed a renewal during the fill or the probe handed room back, and the room after the probe rises with it. A missing grant file prints `grant -`, which parses as no id, so an unmeasured claim reads as no grant and fails its caller's check.
export function parseLook(lines: string[]): Look {
  const published = ids(lines);
  const [first = ""] = published;
  const grantLine = lines.find((l) => l.startsWith(`grant ${first} `)) ?? "";
  return {
    id: first,
    grantMiB: first ? grantMiB(grantLine) : Number.NaN,
    filledMiB: kbAfter(lines, "avail-after-fill="),
    afterProbeMiB: kbAfter(lines, "avail-after-probe="),
    grantStable:
      published.length === 3 &&
      first !== "" &&
      published.every((id) => id === first),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: whether the case may judge a look: the runner published one grant across the whole look, that grant is one published after `after`, the fill brought the guest down to its share, and the guard left the room there through the probe. The last two are the guard's own evidence and not the runner's: a look the guard released room in is one a renewal reached mid-fill or mid-probe, and its probe line says nothing about the product. A guard that holds the guest at its share through the probe with all of that true still fails the case, which is the wedge the case is for.
export function judgeable(
  look: Look,
  after: string,
  floorMiB: number,
  slackMiB: number,
): boolean {
  return (
    look.grantStable &&
    look.id !== after &&
    Number.isFinite(look.grantMiB) &&
    Number.isFinite(look.filledMiB) &&
    Number.isFinite(look.afterProbeMiB) &&
    look.filledMiB <= floorMiB + slackMiB &&
    look.afterProbeMiB <= floorMiB + slackMiB
  );
}

if (import.meta.main) {
  const shared = (mib: number) => mib * 1048576;
  const grant = (id: string, mib: number) => `grant ${id} ${shared(mib)}`;
  const FLOOR = 256;
  const SLACK = 60;

  const room = parseRoom([
    grant("7", 20_000),
    "avail=10240",
    grant("7", 20_000),
  ]);
  assert.equal(room.stable, true);
  assert.equal(room.grantMiB, 20000);
  assert.equal(room.availMiB, 10);
  assert.equal(judged(room, "6"), true);
  assert.equal(judged(room, "7"), false);
  // TEST_SCENARIO: a renewal lands between a reading's two grant lines, so its room belongs to neither grant and no bound compares with it.
  const moved = parseRoom([
    grant("7", 20_000),
    "avail=10240",
    grant("8", 20_000),
  ]);
  assert.equal(moved.stable, false);
  assert.equal(judged(moved, "6"), false);
  // TEST_SCENARIO: an absent grant file is no grant, not the `df` row standing in for one.
  const absent = parseRoom(["grant -", "avail=10240", "grant -"]);
  assert.equal(Number.isFinite(absent.grantMiB), false);
  assert.equal(judged(absent, "6"), false);
  // TEST_SCENARIO: a reading that printed no room fails rather than passing a figure.
  const blindRoom = parseRoom([grant("9", 100), grant("9", 100)]);
  assert.equal(Number.isFinite(blindRoom.availMiB), false);
  assert.equal(judged(blindRoom, "6"), false);

  const look = (grantIds: string[], filled: number, afterProbe: number) =>
    parseLook([
      grant(grantIds[0], 20_000),
      `avail-after-fill=${filled * 1024}`,
      grant(grantIds[1], 20_000),
      "probe=refused",
      "No space left on device",
      `avail-after-probe=${afterProbe * 1024}`,
      grant(grantIds[2], 20_000),
    ]);

  const held = look(["7", "7", "7"], 10, 10);
  assert.equal(held.grantStable, true);
  assert.equal(held.grantMiB, 20000);
  assert.equal(held.filledMiB, 10);
  assert.equal(held.afterProbeMiB, 10);
  assert.equal(judgeable(held, "6", FLOOR, SLACK), true);

  // TEST_SCENARIO: a renewal lands between the case's fill and its probe, so the published grant moves and the look straddles it. Its probe line may read either way and means nothing.
  assert.equal(
    judgeable(look(["7", "8", "8"], 10, 10), "6", FLOOR, SLACK),
    false,
  );

  // TEST_SCENARIO: the runner published one id throughout, and the guard consumed it only after the fill, so the room came back by the probe. The probe then wrote, and that is no product evidence: the case must retry.
  assert.equal(
    judgeable(look(["8", "8", "8"], 10, 20_000), "6", FLOOR, SLACK),
    false,
  );

  // TEST_SCENARIO: a guard that hands room back during the probe is caught by the room read after it, even with all three grant lines agreeing and the room after the fill at the floor.
  assert.equal(
    judgeable(look(["8", "8", "8"], 10, 512), "6", FLOOR, SLACK),
    false,
  );

  // TEST_SCENARIO: the room never reached the share, so the fill did not run and the look proves nothing about the probe.
  assert.equal(
    judgeable(look(["8", "8", "8"], 20_000, 20_000), "6", FLOOR, SLACK),
    false,
  );

  // TEST_SCENARIO: a grant the case's own writes ran into is not a renewal.
  assert.equal(judgeable(held, "7", FLOOR, SLACK), false);

  // TEST_SCENARIO: an absent grant file is no grant here either.
  const absentLook = parseLook([
    "grant -",
    "avail-after-fill=10240",
    "grant -",
    "avail-after-probe=10240",
    "grant -",
  ]);
  assert.equal(Number.isFinite(absentLook.grantMiB), false);
  assert.equal(judgeable(absentLook, "6", FLOOR, SLACK), false);

  // TEST_SCENARIO: a look that printed no room at all fails rather than passing a figure.
  const blindLook = parseLook([
    grant("9", 100),
    grant("9", 100),
    grant("9", 100),
  ]);
  assert.equal(Number.isFinite(blindLook.filledMiB), false);
  assert.equal(judgeable(blindLook, "6", FLOOR, SLACK), false);

  console.log("storage-look self-check OK");
}
