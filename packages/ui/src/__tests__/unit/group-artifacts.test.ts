import type { ArtifactFolder, LibraryArtifact } from "api-server-api";
import { EXPERIMENT_FOLDER_PREFIX } from "api-server-api";
import { describe, expect, test } from "vitest";

import {
  groupArtifactsByFolder,
  UNGROUPED_KEY,
} from "../../modules/artifacts/lib/group-artifacts.js";

const artifact = (id: string, folderId: string | null): LibraryArtifact => ({
  id,
  title: id,
  slug: id,
  kind: "markdown",
  contentType: "text/markdown",
  fileName: `${id}.md`,
  sizeBytes: 1,
  version: 1,
  folderId,
  agentId: null,
  visibility: "private",
  viewers: [],
  expiresAt: null,
  viewCount: 0,
  shareUrl: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

const folder = (id: string, name = id): ArtifactFolder => ({
  id,
  name,
  slug: id,
  artifactCount: 0,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
});

/**
 * TEST_OVERVIEW: grouping for the folder-aware artifact lists — every user
 * folder is a group (empty included), experiment folders appear only when
 * they hold artifacts, Ungrouped comes last, and no artifact is ever dropped
 * even when its folder is unknown to the folders list.
 */
describe("groupArtifactsByFolder", () => {
  test("lists every user folder, empty ones included, with Ungrouped last", () => {
    const groups = groupArtifactsByFolder(
      [artifact("a1", "f1"), artifact("a2", null)],
      [folder("f1"), folder("f2")],
    );
    expect(groups.map((g) => g.key)).toEqual(["f1", "f2", UNGROUPED_KEY]);
    expect(groups[1]?.artifacts).toEqual([]);
    expect(groups[2]?.artifacts.map((a) => a.id)).toEqual(["a2"]);
  });

  test("includes an experiment folder only when it holds artifacts", () => {
    const exp = folder("e1", `${EXPERIMENT_FOLDER_PREFIX}run`);
    expect(groupArtifactsByFolder([], [exp]).map((g) => g.key)).toEqual([]);
    expect(
      groupArtifactsByFolder([artifact("a1", "e1")], [exp]).map((g) => g.key),
    ).toEqual(["e1"]);
  });

  test("omits an empty Ungrouped unless includeEmptyUngrouped", () => {
    expect(groupArtifactsByFolder([], [folder("f1")])).toHaveLength(1);
    const withEmpty = groupArtifactsByFolder([], [folder("f1")], {
      includeEmptyUngrouped: true,
    });
    expect(withEmpty.map((g) => g.key)).toEqual(["f1", UNGROUPED_KEY]);
  });

  test("never drops an artifact whose folder is missing from the folders list", () => {
    const groups = groupArtifactsByFolder(
      [artifact("a1", "gone"), artifact("a2", null)],
      [],
    );
    expect(groups.map((g) => g.key)).toEqual([UNGROUPED_KEY]);
    expect(groups[0]?.artifacts.map((a) => a.id)).toEqual(["a1", "a2"]);
  });
});
