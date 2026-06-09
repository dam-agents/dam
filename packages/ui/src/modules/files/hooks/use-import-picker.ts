import { useState } from "react";

import {
  type BundleEntry,
  filterImportEntries,
  isTarballName,
  walkFileSystemEntry,
} from "../api/import-bundle.js";

/** A staged top-level item; `entries` resolves to its filtered files once the background walk finishes. */
export interface ImportPick {
  key: string;
  name: string;
  isFolder: boolean;
  entries: Promise<BundleEntry[]>;
}

interface PickerState {
  picks: ImportPick[];
  rawBundle: File | null;
}

export interface ImportPicker {
  picks: ImportPick[];
  rawBundle: File | null;
  hasContent: boolean;
  /** "X folders and Y individual files selected", or "" when empty. */
  summary: string;
  /** Read top-level entries synchronously, walk each in the background. */
  addDrop: (items: DataTransferItemList) => void;
  /** Stage already-materialized entries (file / folder `<input>` picks). */
  addBundleEntries: (entries: BundleEntry[]) => void;
  removePick: (key: string) => void;
  clear: () => void;
  /** Await every background walk, then dedupe by path for the tar bundle. */
  resolveEntries: () => Promise<BundleEntry[]>;
}

const filtered = (entries: BundleEntry[]) => filterImportEntries(entries).kept;

function rawBundleToPick(file: File): ImportPick {
  return {
    key: file.name,
    name: file.name,
    isFolder: false,
    entries: Promise.resolve([{ path: file.name, file }]),
  };
}

/** Fold any pass-through bundle into a pick, then merge incoming (same name replaces). */
function mergePicks(prev: PickerState, incoming: ImportPick[]): PickerState {
  const base = prev.rawBundle
    ? [...prev.picks, rawBundleToPick(prev.rawBundle)]
    : prev.picks;
  const byKey = new Map(base.map((p) => [p.key, p]));
  for (const p of incoming) byKey.set(p.key, p);
  return { picks: Array.from(byKey.values()), rawBundle: null };
}

function buildSummary(folders: number, files: number): string {
  const parts: string[] = [];
  if (folders > 0) parts.push(`${folders} folder${folders === 1 ? "" : "s"}`);
  if (files > 0)
    parts.push(`${files} individual file${files === 1 ? "" : "s"}`);
  return parts.length > 0 ? `${parts.join(" and ")} selected` : "";
}

export function useImportPicker(): ImportPicker {
  const [state, setState] = useState<PickerState>({
    picks: [],
    rawBundle: null,
  });

  const isEmpty = state.picks.length === 0 && !state.rawBundle;

  const addDrop = (items: DataTransferItemList) => {
    const tops: FileSystemEntry[] = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) tops.push(entry);
    }
    if (tops.length === 0) return;

    // Single tarball at the root with nothing else staged → send verbatim.
    if (
      isEmpty &&
      tops.length === 1 &&
      tops[0].isFile &&
      isTarballName(tops[0].name)
    ) {
      (tops[0] as FileSystemFileEntry).file((file) =>
        setState({ picks: [], rawBundle: file }),
      );
      return;
    }

    const incoming = tops.map<ImportPick>((entry) => ({
      key: entry.name,
      name: entry.name,
      isFolder: entry.isDirectory,
      entries: walkFileSystemEntry(entry).then(filtered),
    }));
    setState((prev) => mergePicks(prev, incoming));
  };

  const addBundleEntries = (entries: BundleEntry[]) => {
    if (entries.length === 0) return;

    if (
      isEmpty &&
      entries.length === 1 &&
      isTarballName(entries[0].path) &&
      !entries[0].path.includes("/")
    ) {
      setState({ picks: [], rawBundle: entries[0].file });
      return;
    }

    const groups = new Map<string, BundleEntry[]>();
    for (const entry of entries) {
      const top = entry.path.split("/")[0];
      const group = groups.get(top);
      if (group) group.push(entry);
      else groups.set(top, [entry]);
    }
    const incoming = Array.from(groups.entries()).map<ImportPick>(
      ([name, group]) => ({
        key: name,
        name,
        isFolder: group.some((e) => e.path.includes("/")),
        // Defer filtering off onChange so a huge folder pick doesn't block the chip render.
        entries: Promise.resolve().then(() => filtered(group)),
      }),
    );
    setState((prev) => mergePicks(prev, incoming));
  };

  const removePick = (key: string) =>
    setState((prev) => ({
      ...prev,
      picks: prev.picks.filter((p) => p.key !== key),
    }));

  const clear = () => setState({ picks: [], rawBundle: null });

  const resolveEntries = async (): Promise<BundleEntry[]> => {
    const walked = await Promise.all(state.picks.map((p) => p.entries));
    const seen = new Set<string>();
    const out: BundleEntry[] = [];
    for (const entry of walked.flat()) {
      if (seen.has(entry.path)) continue;
      seen.add(entry.path);
      out.push(entry);
    }
    return out;
  };

  const folders = state.picks.filter((p) => p.isFolder).length;
  const files = state.picks.length - folders;

  return {
    picks: state.picks,
    rawBundle: state.rawBundle,
    hasContent: !isEmpty,
    summary: buildSummary(folders, files),
    addDrop,
    addBundleEntries,
    removePick,
    clear,
    resolveEntries,
  };
}
