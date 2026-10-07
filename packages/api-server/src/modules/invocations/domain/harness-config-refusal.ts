import type { InvocationHarnessConfig } from "api-server-api";

export interface TargetHarnessConfigSupport {
  supported: boolean;
  optionIds: string[] | null;
}

export type ReadHarnessConfigSupport = (
  targetAgentId: string,
) => Promise<TargetHarnessConfigSupport | null>;

export const HARNESS_CONFIG_STEP = "harness config";

const requestedSettingIds = (requested: InvocationHarnessConfig): string[] => [
  ...(requested.model !== undefined ? ["model"] : []),
  ...(requested.mode !== undefined ? ["mode"] : []),
  ...Object.keys(requested.configOptions ?? {}),
];

export const harnessConfigRefusal = (
  requested: InvocationHarnessConfig | null,
  support: TargetHarnessConfigSupport | null,
): string | null => {
  if (requested === null || support === null) return null;
  if (!support.supported) return "its image declares no harness-config driver";
  if (support.optionIds === null) return null;
  const offered = new Set(support.optionIds);
  const missing = requestedSettingIds(requested).filter(
    (id) => !offered.has(id),
  );
  if (missing.length === 0) return null;
  return `its harness offers no setting ${missing
    .map((id) => `"${id}"`)
    .join(", ")}`;
};
