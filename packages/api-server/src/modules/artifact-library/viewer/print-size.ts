import { ARTIFACT_PRINT_MAX_WIDTH, ARTIFACT_SIZE_TYPE } from "api-server-api";

export const ARTIFACT_SIZE_REPORTER_BODY = `
(() => {
  const root = document.documentElement;
  let reported = 0;
  const report = () => {
    const height = Math.ceil(Math.max(root.scrollHeight, document.body ? document.body.scrollHeight : 0));
    if (!height || height === reported) return;
    reported = height;
    window.parent.postMessage({ type: ${JSON.stringify(ARTIFACT_SIZE_TYPE)}, height }, "*");
  };
  const observer = new ResizeObserver(report);
  observer.observe(root);
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body) observer.observe(document.body);
    report();
  });
  window.addEventListener("load", report);
})();
`;

export const ARTIFACT_SIZE_REPORTER = `<script>${ARTIFACT_SIZE_REPORTER_BODY}</script>`;

export const FRAME_PRINT_BODY = `
(() => {
  const frame = document.querySelector("iframe");
  let height = 0;
  window.addEventListener("message", (event) => {
    if (!frame.contentWindow || event.source !== frame.contentWindow) return;
    const data = event.data;
    if (!data || data.type !== ${JSON.stringify(ARTIFACT_SIZE_TYPE)}) return;
    if (typeof data.height === "number" && data.height > 0 && data.height <= 1000000) height = data.height;
  });
  window.addEventListener("beforeprint", () => {
    if (!height) return;
    const width = frame.getBoundingClientRect().width;
    const scale = Math.min(1, ${ARTIFACT_PRINT_MAX_WIDTH} / width);
    Object.assign(frame.style, {
      flex: "none",
      width: width + "px",
      height: height + "px",
      transform: "scale(" + scale + ")",
      transformOrigin: "0 0",
      marginRight: (scale - 1) * width + "px",
      marginBottom: (scale - 1) * height + "px",
    });
  });
  window.addEventListener("afterprint", () => frame.removeAttribute("style"));
})();
`;
