import { useStore } from "@/store";

import type { FileContent } from "../../../modules/files/api/queries.js";
import { CODING_FILES } from "../../backend/agent-fixtures";
import { ago, IDS } from "../../backend/scenario";
import { resetState } from "../agents/story-helpers";

const MIME: Record<string, string> = {
  md: "text/markdown",
  ts: "text/typescript",
  json: "application/json",
};

/** A checkout-service workspace file, as `files.read` serves it. */
export function codingFile(path: string): FileContent {
  const content = CODING_FILES[path];
  if (content === undefined) throw new Error(`no fixture file ${path}`);
  return {
    path,
    content,
    binary: false,
    mimeType: MIME[path.split(".").pop() ?? ""] ?? "text/plain",
    mtimeMs: Date.parse(ago(60 * 3)),
  };
}

/** Loader: checkout-service selected in the store, optionally with folders
 *  expanded and a file open in the viewer. */
export function openWorkspace(
  opts: { expanded?: string[]; openFile?: string; edit?: boolean } = {},
) {
  return () => {
    resetState();
    useStore.setState({
      selectedAgent: IDS.codingAgent,
      expandedDirs: { [IDS.codingAgent]: new Set(opts.expanded ?? []) },
      openFilePath: opts.openFile ?? null,
      openFileEdit: opts.edit ?? false,
    });
    return {};
  };
}
