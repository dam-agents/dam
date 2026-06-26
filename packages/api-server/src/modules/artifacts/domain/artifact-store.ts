/** A stored Experiment Candidate blob and its metadata. */
export interface Artifact {
  /** Opaque logical address the caller chose (e.g. experiment/agent/run/name). */
  key: string;
  content: Buffer;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

/** Storage port for Candidate artifacts. The Postgres adapter is the only impl
 *  today; the port exists so the backend can be swapped (the storage choice has
 *  already changed more than once) without touching callers. */
export interface ArtifactStore {
  /** Store the blob at `key`, overwriting any existing blob there. */
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  /** Fetch the blob at `key`, or null if none exists. */
  get(key: string): Promise<Artifact | null>;
  /** Whether a blob exists at `key`. */
  exists(key: string): Promise<boolean>;
}
