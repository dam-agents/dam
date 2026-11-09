import type { GitHubAppInstallations } from "api-server-api";

function counted(n: number, noun: string, more: boolean): string {
  return `${n}${more ? "+" : ""} ${noun}${n === 1 && !more ? "" : "s"}`;
}

export function installationsCountLabel({
  accounts,
  truncated,
}: GitHubAppInstallations): string {
  const noun = accounts.every((a) => a.kind === "organization")
    ? "organization"
    : "account";
  return counted(accounts.length, noun, truncated === true);
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
