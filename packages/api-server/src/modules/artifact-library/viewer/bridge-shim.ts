import {
  ARTIFACT_PROMPT_MAX_LENGTH,
  ARTIFACT_PROMPT_TYPE,
  ARTIFACT_REQUEST_TYPE,
  ARTIFACT_REQUEST_TIMEOUT_MS,
  ARTIFACT_RESPONSE_TYPE,
} from "api-server-api";
import { artifactApiMethodSchema } from "agent-runtime-api";

const METHODS = artifactApiMethodSchema.options;

export const ARTIFACT_BRIDGE_SHIM_BODY = `
window.platform = (() => {
  const pending = new Map();
  let nextId = 0;
  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== ${JSON.stringify(ARTIFACT_RESPONSE_TYPE)}) return;
    const call = pending.get(data.id);
    if (!call) return;
    pending.delete(data.id);
    clearTimeout(call.timer);
    if (data.ok) call.resolve({ status: data.status, contentType: data.contentType, body: data.body });
    else call.reject(Object.assign(new Error("Artifact API request failed: " + data.reason), { reason: data.reason }));
  });
  return Object.freeze({
    sendPrompt(prompt) {
      if (typeof prompt !== "string" || !prompt.trim() || prompt.trim().length > ${ARTIFACT_PROMPT_MAX_LENGTH})
        throw new Error("Provide a nonempty prompt of at most ${ARTIFACT_PROMPT_MAX_LENGTH} characters.");
      window.parent.postMessage({ type: ${JSON.stringify(ARTIFACT_PROMPT_TYPE)}, prompt }, "*");
    },
    request({ method, path, body, contentType } = {}) {
      if (!${JSON.stringify(METHODS)}.includes(method))
        throw new Error("Use one of these methods: ${METHODS.join(", ")}.");
      if (typeof path !== "string" || !path.startsWith("/"))
        throw new Error('Provide a path that starts with "/".');
      if (body !== undefined && typeof body !== "string")
        throw new Error("Provide the body as a string.");
      const id = ++nextId + "-" + Math.random().toString(36).slice(2);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error("Artifact API request failed: timeout"), { reason: "timeout" }));
        }, ${ARTIFACT_REQUEST_TIMEOUT_MS});
        pending.set(id, { resolve, reject, timer });
        window.parent.postMessage({ type: ${JSON.stringify(ARTIFACT_REQUEST_TYPE)}, id, method, path, body, contentType }, "*");
      });
    },
  });
})();
`;

export const ARTIFACT_BRIDGE_SHIM = `<script>${ARTIFACT_BRIDGE_SHIM_BODY}</script>`;

export const SHARED_BRIDGE_REFUSAL =
  "This is a public copy: only its owner can use buttons that ask the agent.";

export const ARTIFACT_SHARED_BRIDGE_SHIM_BODY = `
window.platform = (() => {
  const message = ${JSON.stringify(SHARED_BRIDGE_REFUSAL)};
  let notice = null;
  const refuse = () => {
    if (!notice && document.body) {
      notice = document.createElement("div");
      notice.setAttribute("role", "status");
      notice.textContent = message;
      notice.style.cssText = "position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;max-width:calc(100% - 32px);padding:8px 14px;border-radius:6px;background:#161616;color:#fafaf9;font:13px/1.4 system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.3)";
      document.body.append(notice);
    }
    return Object.assign(new Error("Artifact API request failed: not-allowed. " + message), { reason: "not-allowed" });
  };
  return Object.freeze({
    sendPrompt() {
      throw refuse();
    },
    request() {
      return Promise.reject(refuse());
    },
  });
})();
`;

export const ARTIFACT_SHARED_BRIDGE_SHIM = `<script>${ARTIFACT_SHARED_BRIDGE_SHIM_BODY}</script>`;
