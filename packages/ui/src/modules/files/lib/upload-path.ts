import { AGENT_HOME_DIR } from "agent-runtime-api";

export const MESSAGE_UPLOAD_ROOT = ".uploads";

const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const SEGMENT = "[A-Za-z0-9._-]+";
const ATTACHMENT_PATH = new RegExp(
  `^(?:${escaped(AGENT_HOME_DIR)}/|~/)?${escaped(MESSAGE_UPLOAD_ROOT)}/(${SEGMENT})/[A-Za-z0-9]+-(${SEGMENT})$`,
);

export function attachmentName(path: string): string | null {
  const match = ATTACHMENT_PATH.exec(path);
  if (!match) return null;
  const [, folder, name] = match;
  if (folder === ".." || folder === "." || name === ".." || name === ".")
    return null;
  return name ?? null;
}

export function withAttachmentNames(text: string): string {
  return text
    .split(/(\s+)/)
    .map((token) => {
      const name = attachmentName(token);
      return name === null ? token : `attached file ${name}`;
    })
    .join("");
}
