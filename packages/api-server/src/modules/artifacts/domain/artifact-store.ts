/** A stored Experiment Candidate blob and its metadata. */
export interface Artifact {
  /** Opaque logical address the caller chose (e.g. experiment/agent/run/name). */
  key: string;
  content: Buffer;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

/** Metadata of a stored blob, without its content. */
export interface ArtifactStat {
  contentType: string;
  sizeBytes: number;
}

/** Storage port for Candidate artifacts. The presign methods mint short-lived
 *  single-object direct-transfer links; a backend that can't (no
 *  browser-reachable endpoint) returns null and callers relay the bytes. */
export interface ArtifactStore {
  /** Store the blob at `key`, overwriting any existing blob there. */
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Artifact | null>;
  /** Stream the blob without buffering it — relay paths pipe this straight
   *  into the HTTP response so large objects never occupy the Node heap. */
  getStream(key: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    sizeBytes: number;
  } | null>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<ArtifactStat | null>;
  /** Missing is not an error. */
  delete(key: string): Promise<void>;
  presignUpload(
    key: string,
    opts: { expiresSeconds: number },
  ): Promise<string | null>;
  presignDownload(
    key: string,
    opts: { filename: string; expiresSeconds: number },
  ): Promise<string | null>;
}
