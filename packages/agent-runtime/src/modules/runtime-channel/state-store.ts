import { z } from "zod";
import type {
  DocumentStore,
  DocumentStoreBackend,
} from "../../core/document-store.js";

const runtimeStateSchema = z.object({
  lastAppliedVersion: z.number(),
  lastAppliedHash: z.string().nullable().catch(null),
  bindingsFingerprint: z.string().optional().catch(undefined),
  eventRuns: z.record(z.string(), z.number()).catch({}).default({}),
});

export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export type StateStore = DocumentStore<RuntimeState>;

export interface StateStoreOpts {
  envReady?: () => boolean;
  bindingsFingerprint?: string;
  log?: (msg: string) => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the runtime's record of the last desired state it applied, which hello reports so the api-server pushes only what is newer. The record only holds while it still describes the disk: the env file that push wrote is still there, and the image binds its contribution drivers as it did when the record was kept. A home restored without the env file, as a runtime migration restores one, or an image whose drivers write somewhere else, drops the applied version and hash, so hello asks for the whole state again and every driver writes it anew. Event runs are kept, so an event that already ran does not run twice.
export function createStateStore(
  backend: DocumentStoreBackend,
  {
    envReady = () => true,
    bindingsFingerprint,
    log = () => {},
  }: StateStoreOpts = {},
): StateStore {
  const store = backend.open("runtime-state", {
    schema: runtimeStateSchema,
    initial: () => ({
      lastAppliedVersion: 0,
      lastAppliedHash: null,
      eventRuns: {},
    }),
  });
  const state = store.read();
  const fingerprint = bindingsFingerprint ?? state.bindingsFingerprint;
  const reason = forgetReason(state, fingerprint, envReady);
  if (reason) {
    log(
      `[runtime] forgetting applied v=${state.lastAppliedVersion}: ${reason}; hello asks for the whole state`,
    );
  }
  if (reason || fingerprint !== state.bindingsFingerprint) {
    store.write({
      ...state,
      bindingsFingerprint: fingerprint,
      ...(reason ? { lastAppliedVersion: 0, lastAppliedHash: null } : {}),
    });
  }
  return store;
}

function forgetReason(
  state: RuntimeState,
  fingerprint: string | undefined,
  envReady: () => boolean,
): string | undefined {
  if (!state.lastAppliedVersion) return undefined;
  if (fingerprint !== state.bindingsFingerprint) {
    return `contribution driver bindings changed (${short(state.bindingsFingerprint)} → ${short(fingerprint)})`;
  }
  if (!envReady()) return "env file missing";
  return undefined;
}

function short(fingerprint: string | undefined): string {
  return (fingerprint ?? "<none>").slice(0, 8);
}
