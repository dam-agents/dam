import type { SkillLocalFiles } from "api-server-api";
import { zipSync } from "fflate";

// Uint8Array<ArrayBuffer>, not the default ArrayBufferLike: BlobPart rejects a
// view that might be backed by a SharedArrayBuffer.
function toBytes(
  file: SkillLocalFiles["files"][number],
): Uint8Array<ArrayBuffer> {
  if (file.base64) {
    const raw = atob(file.content);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  return new TextEncoder().encode(file.content);
}

function save(blob: Blob, name: string): void {
  const a = document.createElement("a");
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  // Deferred: revoking in the click's tick can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Save a Local Skill's files. A lone SKILL.md downloads as `<dir>.md` so it
 * round-trips back through the upload flow; anything larger becomes `<dir>.zip`
 * with entries under `<dir>/`, so unzipping yields the skill directory.
 *
 * Named from `dir` (the pod's on-disk basename), not the display name, so an
 * uploaded skill whose name isn't slug-shaped still lands under its real
 * directory.
 */
export function saveSkillFiles(skill: SkillLocalFiles): void {
  const { dir, files } = skill;
  if (files.length === 1 && files[0].relPath === "SKILL.md") {
    save(new Blob([toBytes(files[0])], { type: "text/markdown" }), `${dir}.md`);
    return;
  }
  const entries = Object.fromEntries(
    files.map((f) => [`${dir}/${f.relPath}`, toBytes(f)]),
  );
  save(new Blob([zipSync(entries)], { type: "application/zip" }), `${dir}.zip`);
}
