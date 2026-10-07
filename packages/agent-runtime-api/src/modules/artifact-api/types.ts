import type {
  ArtifactApiRequestInput,
  ArtifactApiRequestResult,
} from "./schemas.js";

export interface ArtifactApiService {
  request(input: ArtifactApiRequestInput): Promise<ArtifactApiRequestResult>;
}
