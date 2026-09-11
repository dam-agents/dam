// TEST_OVERVIEW: unpacking an image is destructive before it is constructive — it clears the directory and rebuilds it — so two agents wanting the same image at the same moment is the case that has to be got right. Placement creates it routinely: a node that has just joined is handed several agents at once and they share an image, and on the node where this was found one of them died with a filesystem error naming a path nobody had asked for.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createImageStore } from "../../modules/sandboxes/infrastructure/image-store.js";

// A saved-image archive: a manifest naming one config and one layer, the layer
// being a tarball of the rootfs.
function savedImage(dir: string): string {
  const layerSrc = join(dir, "layer");
  mkdirSync(join(layerSrc, "etc"), { recursive: true });
  mkdirSync(join(layerSrc, "usr", "bin"), { recursive: true });
  writeFileSync(join(layerSrc, "etc", "hosts"), "127.0.0.1 localhost\n");
  writeFileSync(join(layerSrc, "usr", "bin", "thing"), "#!/bin/sh\n");
  execFileSync("tar", [
    "--create",
    "--file",
    join(dir, "layer.tar"),
    "-C",
    layerSrc,
    ".",
  ]);
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({ config: { Env: [], Cmd: ["/usr/bin/thing"] } }),
  );
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify([{ Config: "config.json", Layers: ["layer.tar"] }]),
  );
  const archive = join(dir, "image.tar");
  execFileSync("tar", [
    "--create",
    "--file",
    archive,
    "-C",
    dir,
    "config.json",
    "manifest.json",
    "layer.tar",
  ]);
  return archive;
}

// TEST_SCENARIO: unpacking uses GNU tar options a node has and a developer's macOS does not, so this runs where the node runs.
describe.skipIf(process.platform !== "linux")(
  "two agents wanting the same image at once",
  () => {
    it("unpacks it once and serves both", async () => {
      const work = mkdtempSync(join(tmpdir(), "image-store-"));
      const archive = savedImage(work);
      const store = createImageStore({
        root: join(work, "images"),
        log: () => {},
      });

      const results = await Promise.all([
        store.ensure(archive),
        store.ensure(archive),
        store.ensure(archive),
        store.ensure(archive),
      ]);

      const rootfs = results[0]!.rootfs;
      for (const r of results) expect(r.rootfs).toBe(rootfs);
      // The directory the losing unpack used to delete out from under the winner.
      expect(() =>
        execFileSync("test", ["-f", join(rootfs, "etc", "hosts")]),
      ).not.toThrow();
      expect(() =>
        execFileSync("test", ["-f", join(rootfs, "usr", "bin", "thing")]),
      ).not.toThrow();
    }, 30_000);
  },
);
