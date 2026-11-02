import { ARTIFACT_PRINT_MAX_WIDTH, artifactSizeMessageSchema } from "api-server-api";

export const ARTIFACT_PRINT_ATTRIBUTE = "data-artifact-print";

export function readArtifactSize(
  event: Pick<MessageEvent, "source" | "data">,
  pageWindow: MessageEventSource | null | undefined,
): number | null {
  if (!pageWindow || event.source !== pageWindow) return null;
  const parsed = artifactSizeMessageSchema.safeParse(event.data);
  return parsed.success ? parsed.data.height : null;
}

export function stretchForPrint(frame: HTMLIFrameElement, height: number): void {
  const width = frame.getBoundingClientRect().width;
  const scale = Math.min(1, ARTIFACT_PRINT_MAX_WIDTH / width);
  frame.setAttribute(ARTIFACT_PRINT_ATTRIBUTE, "");
  Object.assign(frame.style, {
    width: `${width}px`,
    height: `${height}px`,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    marginRight: `${(scale - 1) * width}px`,
    marginBottom: `${(scale - 1) * height}px`,
  });
}

export function restoreAfterPrint(frame: HTMLIFrameElement): void {
  frame.removeAttribute(ARTIFACT_PRINT_ATTRIBUTE);
  frame.removeAttribute("style");
}
