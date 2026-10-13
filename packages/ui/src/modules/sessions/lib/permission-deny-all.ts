import type { PermissionOption } from "../store/permissions.js";

export function denyOnceOption(
  options: readonly PermissionOption[],
): PermissionOption | undefined {
  return options.find((opt) => opt.kind === "reject_once");
}
