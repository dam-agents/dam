import type {
  ArtifactApiRelayInput,
  ArtifactApiRequestResult,
} from "./schemas.js";

export interface ArtifactApiService {
  request(input: ArtifactApiRelayInput): Promise<ArtifactApiRequestResult>;
}
