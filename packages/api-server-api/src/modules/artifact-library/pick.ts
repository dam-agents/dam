import { z } from "zod";

export const ARTIFACT_PICK_START_TYPE = "artifact.pick.start";
export const ARTIFACT_PICK_STOP_TYPE = "artifact.pick.stop";
export const ARTIFACT_PICK_TYPE = "artifact.pick";
export const ARTIFACT_PICK_CANCEL_TYPE = "artifact.pick.cancel";

export const ARTIFACT_PICK_MAX_ELEMENTS = 8;
export const ARTIFACT_PICK_SELECTOR_MAX_LENGTH = 300;
export const ARTIFACT_PICK_SNIPPET_MAX_LENGTH = 600;

export const artifactPickedElementSchema = z.object({
  selector: z.string().min(1).max(ARTIFACT_PICK_SELECTOR_MAX_LENGTH),
  snippet: z.string().min(1).max(ARTIFACT_PICK_SNIPPET_MAX_LENGTH),
});

export type ArtifactPickedElement = z.infer<typeof artifactPickedElementSchema>;

export const artifactPickMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal(ARTIFACT_PICK_TYPE),
    elements: z
      .array(artifactPickedElementSchema)
      .min(1)
      .max(ARTIFACT_PICK_MAX_ELEMENTS),
  }),
  z.object({ type: z.literal(ARTIFACT_PICK_CANCEL_TYPE) }),
]);

export type ArtifactPickMessage = z.infer<typeof artifactPickMessageSchema>;
