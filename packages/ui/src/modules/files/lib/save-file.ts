import { getErrorMessage } from "../../../lib/errors.js";

export interface SaveFileDeps {
  write: (input: {
    content: string;
    expectedMtimeMs?: number;
  }) => Promise<{ mtimeMs: number }>;
  confirmOverwrite: () => Promise<boolean>;
}

export type SaveFileOutcome =
  | { kind: "saved"; mtimeMs: number }
  | { kind: "kept" }
  | { kind: "failed"; message: string };

const failed = (err: unknown): SaveFileOutcome => ({
  kind: "failed",
  message: getErrorMessage(err, "Save failed"),
});

export async function saveFileDraft(
  draft: string,
  baseMtimeMs: number | undefined,
  deps: SaveFileDeps,
): Promise<SaveFileOutcome> {
  try {
    const res = await deps.write({
      content: draft,
      expectedMtimeMs: baseMtimeMs,
    });
    return { kind: "saved", mtimeMs: res.mtimeMs };
  } catch (err) {
    if (!/conflict|changed on disk/i.test(getErrorMessage(err, ""))) {
      return failed(err);
    }
    if (!(await deps.confirmOverwrite())) {
      return { kind: "kept" };
    }
    try {
      const res = await deps.write({ content: draft });
      return { kind: "saved", mtimeMs: res.mtimeMs };
    } catch (err2) {
      return failed(err2);
    }
  }
}
