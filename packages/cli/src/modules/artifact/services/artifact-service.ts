import type { ArtifactSharingInput, LibraryArtifact } from "api-server-api";
import type { Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

type ArtifactResult<T> = Promise<Result<T, TransportError | AuthRequiredError>>;

export interface ArtifactService {
  get(id: string): ArtifactResult<LibraryArtifact>;
  setSharing(
    id: string,
    input: ArtifactSharingInput,
  ): ArtifactResult<LibraryArtifact>;
}

export function createArtifactService(deps: {
  trpc: TrpcClient;
}): ArtifactService {
  return {
    async get(id) {
      return trpcCall(() => deps.trpc.artifactLibrary.get.query({ id }));
    },
    async setSharing(id, input) {
      return trpcCall(() =>
        deps.trpc.artifactLibrary.setSharing.mutate({ id, ...input }),
      );
    },
  };
}
