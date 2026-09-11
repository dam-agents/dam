// TEST_OVERVIEW: placement decides which node builds an agent's sandbox. Three properties carry the whole design: an agent goes back to the node that still has its workspace on disk, otherwise it goes where there is the most room, and an agent that fits nowhere is left unplaced rather than crammed onto the emptiest node and making everything there slower.
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
