export const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

export function isExternalHttpUrl(href: string): boolean {
  try {
    const { protocol } = new URL(href);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
