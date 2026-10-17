export const SIDEBAR_ITEM =
  "flex h-[34px] w-full items-center gap-3 rounded-lg px-2.5 transition-colors";

export function sidebarItemTone(active: boolean): string {
  return active
    ? "text-primary bg-muted"
    : "text-foreground/80 hover:text-foreground hover:bg-muted";
}
