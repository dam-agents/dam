import type { GitHubAppInstallations } from "api-server-api";

export function installationsCountLabel({
  accounts,
  truncated,
}: GitHubAppInstallations): string {
  const n = accounts.length;
  const more = truncated === true;
  return `${n}${more ? "+" : ""} account${n === 1 && !more ? "" : "s"}`;
}

export function sizedAvatarUrl(url: string, px: number): string {
  try {
    const sized = new URL(url);
    sized.searchParams.set("s", String(px));
    return sized.toString();
  } catch {
    return url;
  }
}
