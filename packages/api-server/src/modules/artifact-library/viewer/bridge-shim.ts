import {
  ARTIFACT_BRIDGE_ANSWER_TYPE,
  ARTIFACT_BRIDGE_CONNECT_TYPE,
  ARTIFACT_BRIDGE_FAILED_TYPE,
  ARTIFACT_BRIDGE_REQUEST_TYPE,
  ARTIFACT_BRIDGE_STATE_TYPE,
} from "api-server-api";

const CONNECT_WAIT_MS = 15_000;

function literal(value: string): string {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

// UNIT_BOUNDARY_DESCRIPTION: The script an interactive page gets for free, so that asking its agent is `await platform.ask(action, payload)` and nothing else. It owns the whole `artifact.connect` handshake — keeping the MessagePort, minting the `ref`, matching a reply back to the ask that is waiting for it — which is work no page author should have to get right, and which stays ours to change only as long as no page does it by hand. It deliberately does not queue, retry or pace: one Artifact Request in flight is the app's rule and the server's rule, so a `busy` refusal reaches the page as a rejection like any other.
export const ARTIFACT_BRIDGE_SHIM_BODY = `
(() => {
  const CONNECT = ${literal(ARTIFACT_BRIDGE_CONNECT_TYPE)};
  const REQUEST = ${literal(ARTIFACT_BRIDGE_REQUEST_TYPE)};
  const STATE = ${literal(ARTIFACT_BRIDGE_STATE_TYPE)};
  const ANSWER = ${literal(ARTIFACT_BRIDGE_ANSWER_TYPE)};
  const FAILED = ${literal(ARTIFACT_BRIDGE_FAILED_TYPE)};
  const CONNECT_WAIT_MS = ${CONNECT_WAIT_MS};

  const waiting = new Map();
  const watchers = new Set();
  let port = null;
  let connected;
  const ready = new Promise((resolve) => { connected = resolve; });
  let asked = 0;

  const refusal = (reason, message) => {
    const error = new Error(message || reason);
    error.reason = reason;
    return error;
  };

  const dropEveryAsk = (error) => {
    for (const settle of waiting.values()) settle.reject(error);
    waiting.clear();
  };

  const receive = (event) => {
    const reply = event.data;
    if (!reply || typeof reply !== "object") return;
    if (reply.type === STATE) {
      for (const watcher of watchers) {
        try { watcher(reply.state); } catch (err) { console.error(err); }
      }
      return;
    }
    const settle = waiting.get(reply.ref);
    if (!settle) return;
    waiting.delete(reply.ref);
    if (reply.type === ANSWER) settle.resolve(reply.result);
    else if (reply.type === FAILED) settle.reject(refusal(reply.reason, reply.message));
  };

  window.addEventListener("message", (event) => {
    if (event.source !== window.parent) return;
    if (!event.data || event.data.type !== CONNECT) return;
    const handed = event.ports[0];
    if (!handed) return;
    if (port) {
      port.close();
      dropEveryAsk(refusal("cancelled", "The page reconnected before the answer arrived."));
    }
    port = handed;
    port.onmessage = receive;
    port.start();
    connected();
  });

  const waitForPort = () => {
    if (port) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const giveUp = setTimeout(
        () => reject(refusal("wake_failed", "The request never reached the agent.")),
        CONNECT_WAIT_MS,
      );
      ready.then(() => { clearTimeout(giveUp); resolve(); });
    });
  };

  const ask = async (action, payload) => {
    if (typeof action !== "string" || action.trim() === "")
      throw new Error("platform.ask needs an action name, e.g. platform.ask('refresh').");
    if (payload !== undefined && (payload === null || typeof payload !== "object" || Array.isArray(payload)))
      throw new Error("platform.ask payload must be a plain object, e.g. { since: '2024-01-01' }.");
    await waitForPort();
    const ref = ++asked + "." + Math.random().toString(36).slice(2, 10);
    return new Promise((resolve, reject) => {
      waiting.set(ref, { resolve, reject });
      window.parent.postMessage({ type: REQUEST, ref, action, payload }, "*");
    });
  };

  const onState = (watcher) => {
    watchers.add(watcher);
    return () => watchers.delete(watcher);
  };

  window.platform = Object.freeze({ ask, onState, ready });
})();
`;

export const ARTIFACT_BRIDGE_SHIM = `<script>${ARTIFACT_BRIDGE_SHIM_BODY}</script>`;
