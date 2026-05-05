/**
 * Pod-files types. Wire types come from `api-server-api` (single source of
 * truth, shared with agent-runtime); producer-side types stay private to
 * the api-server because the agent never needs to know about producers.
 *
 * See docs/adrs/034-pod-files-push.md.
 */

export {
  FileFragmentSchema,
  FileSpecSchema,
  MergeModeSchema,
  PodFilesEventSchema,
} from "api-server-api";
export type {
  FileFragment,
  FileSpec,
  MergeMode,
  PodFilesEvent,
} from "api-server-api";

import type { FileSpec } from "api-server-api";

/**
 * Names the *state source* a producer reads. State-mutating services tag
 * their publishes with the source they just changed; the publisher only
 * runs producers tagged with that source. Keep names aligned with what
 * the source actually is (the system, not the action) so producers and
 * publishers can match by string.
 */
export const PRODUCER_SOURCES = ["app-connections"] as const;
export type ProducerSource = (typeof PRODUCER_SOURCES)[number];

/**
 * A producer reads the platform's state for an `(owner, agentId)` pair and emits
 * the files it wants materialized in that agent's pods. Producers are
 * **agent-scoped**: the file content for one agent reflects only what's
 * been explicitly granted/configured for that agent, not the owner's
 * broader state in adjacent systems.
 *
 * Opaque source: the platform doesn't know whether the producer's state
 * is app connections, secrets, or something else — only the `source` tag
 * is used for routing.
 */
export interface FileProducer {
  /** Stable id, used for logging. */
  id: string;
  /**
   * State source this producer reads. `publishForOwner(.., source)` only
   * runs producers whose `source` matches.
   */
  source: ProducerSource;
  /**
   * Compute this producer's `FileSpec`s for the given agent under `owner`.
   * Empty array means "this producer has nothing to contribute right now".
   * Errors should be caught by the caller — a producer crash must not
   * block the others.
   */
  produce(owner: string, agentId: string): Promise<FileSpec[]>;
}
