import { createHash } from "node:crypto";
import { dump, loadAll } from "js-yaml";
import type { KubeObject } from "../agents/infrastructure/k8s.js";

export interface SnapshotDocument {
  kind: string;
  name: string;
  uid: string | null;
  sha256: string;
  yaml: string;
}

export interface AgentStoreSnapshot {
  yaml: string;
  sha256: string;
  documents: SnapshotDocument[];
}

type Document = Record<string, unknown> & {
  kind?: string;
  metadata?: Record<string, unknown>;
};

const CARRIED_METADATA = [
  "name",
  "uid",
  "creationTimestamp",
  "deletionTimestamp",
  "generation",
  "labels",
  "annotations",
  "finalizers",
  "ownerReferences",
] as const;

const sanitize = (resource: KubeObject): Document => {
  const source = resource as Document;
  const metadata = source.metadata ?? {};
  const carried: Record<string, unknown> = {};
  for (const key of CARRIED_METADATA)
    if (metadata[key] !== undefined) carried[key] = metadata[key];
  return { ...source, metadata: carried };
};

const sha256 = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/**
 * UNIT_BOUNDARY_DESCRIPTION: the switch's archive of the custom resources it
 * absorbs, built from what the API server listed so it holds every resource
 * rather than every importable one, and verified by parsing it back before it is
 * written anywhere.
 *
 * It is source-complete on purpose: a resource the mapping refuses becomes no
 * row, so the archive is the only copy of it, and a rollback reads the archive
 * when the rows are not enough. Ordering is fixed by kind and name so the same
 * fleet produces the same bytes and the same digest, which is what the object
 * store copy is verified against.
 */
export function buildAgentStoreSnapshot(input: {
  agents: KubeObject[];
  budgets: KubeObject[];
}): AgentStoreSnapshot {
  const resources = [...input.agents, ...input.budgets].map(sanitize);
  resources.sort((a, b) => {
    const kind = (a.kind ?? "").localeCompare(b.kind ?? "");
    if (kind !== 0) return kind;
    return String(a.metadata?.name ?? "").localeCompare(
      String(b.metadata?.name ?? ""),
    );
  });

  const documents: SnapshotDocument[] = resources.map((resource) => {
    const yaml = dump(resource, { noRefs: true, lineWidth: -1 });
    const uid = resource.metadata?.uid;
    return {
      kind: resource.kind ?? "",
      name: String(resource.metadata?.name ?? ""),
      uid: typeof uid === "string" ? uid : null,
      sha256: sha256(yaml),
      yaml,
    };
  });

  if (documents.length > 0) {
    const parsed = loadAll(documents.map((doc) => doc.yaml).join("---\n"));
    if (parsed.length !== documents.length)
      throw new Error(
        `the archive reads back as ${parsed.length} document(s), not ${documents.length}: refusing to write an archive that does not parse to what it holds`,
      );
  }

  const yaml = documents.map((doc) => doc.yaml).join("---\n");
  return { yaml, sha256: sha256(yaml), documents };
}
