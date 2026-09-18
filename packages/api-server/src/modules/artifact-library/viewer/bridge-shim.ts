import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
} from "api-server-api";

export const ARTIFACT_BRIDGE_SHIM_BODY = `
window.platform = Object.freeze({
  sendPrompt(prompt) {
    if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().length > ${ARTIFACT_PROMPT_MAX_LENGTH})
      throw new Error("Provide a nonempty prompt of at most ${ARTIFACT_PROMPT_MAX_LENGTH} characters.");
    window.parent.postMessage({ type: ${JSON.stringify(ARTIFACT_PROMPT_TYPE)}, prompt }, "*");
  },
});
`;

export const ARTIFACT_BRIDGE_SHIM = `<script>${ARTIFACT_BRIDGE_SHIM_BODY}</script>`;
