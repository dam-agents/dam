export const MESSAGE_UPLOAD_ROOT = ".uploads";

const UPLOAD_PATH = new RegExp(
  String.raw`(?:\S*/)?${MESSAGE_UPLOAD_ROOT.replace(".", String.raw`\.`)}/[^/\s]+/[A-Za-z0-9]+-(\S+)`,
  "g",
);

export function withAttachmentNames(text: string): string {
  return text.replace(
    UPLOAD_PATH,
    (_, name: string) => `attached file ${name}`,
  );
}
