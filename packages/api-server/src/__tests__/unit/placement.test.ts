// TEST_OVERVIEW: placement decides which node builds an agent's sandbox. Four properties carry the whole design: an agent goes back to the node that still has its workspace on disk, otherwise it goes where there is the most room, only the memory it is promised can run out, and an agent whose promise cannot be kept anywhere is left unplaced rather than crammed onto the emptiest node.
import { describe, expect, it } from "vitest";
import {
  choosePlacement,
  demandOf,
  EMPTY_LOAD,
  type NodeCapacity,
  type NodeLoad,
} from "../../modules/nodes/domain/placement.js";

const node = (id: string, cpu: number, memGi: number): NodeCapacity => ({
  id,
  cpuMilli: cpu * 1000,
  memoryBytes: memGi * 1024 ** 3,
});

const load = (cpu: number, memGi: number): NodeLoad => ({
  cpuMilli: cpu * 1000,
  memoryBytes: memGi * 1024 ** 3,
});

const place = (
  ready: NodeCapacity[],
  loads: Record<string, NodeLoad>,
  want: NodeLoad,
  preferred: string | null = null,
) =>
  choosePlacement({
    ready,
    loadOf: (id) => loads[id] ?? EMPTY_LOAD,
    want,
    preferred,
  });

describe("choosing a node", () => {
  const three = [node("a", 8, 16), node("b", 8, 16), node("c", 8, 16)];

  it("spreads onto the emptiest node", () => {
    const loads = { a: load(6, 2), b: load(1, 1), c: load(4, 4) };
    expect(place(three, loads, load(1, 1))).toBe("b");
  });

  // TEST_SCENARIO: the workspace is on the node's local disk, so going back to it is the difference between waking and restoring from a snapshot first.
  it("returns to the node that last ran the agent", () => {
    const loads = { a: load(6, 2), b: load(1, 1), c: load(4, 4) };
    expect(place(three, loads, load(1, 1), "c")).toBe("c");
  });

  it("does not return to a node the agent no longer fits on", () => {
    const loads = { a: load(0, 0), b: load(0, 0), c: load(7, 15) };
    expect(place(three, loads, load(4, 4), "c")).not.toBe("c");
  });

  it("ignores a preference for a node that is not ready", () => {
    expect(place([node("a", 8, 16)], {}, load(1, 1), "gone")).toBe("a");
  });

  // TEST_SCENARIO: a node with CPU to spare but no memory left must not look idle, or every placement lands on it until it thrashes.
  it("measures the fuller of the two dimensions", () => {
    const loads = { a: load(7, 1), b: load(1, 15) };
    expect(
      place([node("a", 8, 16), node("b", 8, 16)], loads, load(1, 0.5)),
    ).toBe("a");
  });

  // TEST_SCENARIO: cramming an agent onto a full node makes every agent there slower with nothing saying why; leaving it unplaced is visible and an operator adds a node.
  it("leaves an agent unplaced when it fits nowhere", () => {
    const loads = { a: load(8, 16), b: load(8, 16), c: load(8, 16) };
    expect(place(three, loads, load(1, 1))).toBeNull();
  });

  // TEST_SCENARIO: a node whose CPU is already spoken for several times over. CPU is a weight on a contended node rather than a reservation, so it cannot run out — refusing the agent here would keep cores idle between somebody's turns, which is most of the time.
  it("places an agent on a node whose CPU is long since oversubscribed", () => {
    expect(
      choosePlacement({
        ready: [node("a", 4, 16)],
        loadOf: () => load(40, 4),
        want: load(4, 1),
        preferred: null,
      }),
    ).toBe("a");
  });

  // TEST_SCENARIO: the same node, out of memory instead. An agent cannot be asked to hand memory back while it is holding it, so the share promised to those already there is gone for as long as they are.
  it("refuses a node that cannot keep the memory promise", () => {
    expect(
      choosePlacement({
        ready: [node("a", 4, 16)],
        loadOf: () => load(0, 15),
        want: load(1, 2),
        preferred: null,
      }),
    ).toBeNull();
  });

  it("has nowhere to put anything when no node is ready", () => {
    expect(place([], {}, load(1, 1))).toBeNull();
  });
});

describe("what an agent asks for", () => {
  it("reads Kubernetes-style limits", () => {
    expect(demandOf({ cpu: "2", memory: "4Gi" })).toEqual({
      cpuMilli: 2000,
      memoryBytes: 4 * 1024 ** 3,
    });
    expect(demandOf({ cpu: "500m", memory: "512Mi" })).toEqual({
      cpuMilli: 500,
      memoryBytes: 512 * 1024 ** 2,
    });
  });

  // TEST_SCENARIO: an agent with no limits must not be treated as infinitely large, or one unspecified agent would make every node look full.
  it("asks for nothing when no limits are set", () => {
    expect(demandOf(undefined)).toEqual(EMPTY_LOAD);
    expect(demandOf({})).toEqual(EMPTY_LOAD);
  });
});
