export interface Artifact {
  key: string;
  content: Buffer;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface ArtifactStat {
  contentType: string;
  sizeBytes: number;
}

export interface ArtifactStore {
  put(input: {
    key: string;
    content: Buffer;
    contentType: string;
  }): Promise<void>;
  get(key: string): Promise<Artifact | null>;
  getStream(key: string): Promise<{
    stream: ReadableStream<Uint8Array>;
    contentType: string;
    sizeBytes: number;
  } | null>;
  exists(key: string): Promise<boolean>;
  head(key: string): Promise<ArtifactStat | null>;
  delete(key: string): Promise<void>;
  presignUpload(
    key: string,
    opts: { expiresSeconds: number; contentLengthBytes?: number },
  ): Promise<string | null>;
  presignDownload(
    key: string,
    opts: {
      filename: string;
      expiresSeconds: number;
      audience: "agent" | "browser";
    },
  ): Promise<string | null>;
}
