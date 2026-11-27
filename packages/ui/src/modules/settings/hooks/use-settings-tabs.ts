import { getBrand } from "../../../brand.js";
import { useInstallCapabilities } from "../../features/api/queries.js";
import { offeredFeatures } from "../../features/lib/visible-features.js";
import { useOperatorAvailability } from "../../operator/api/queries.js";
import type { SettingsTab } from "../../platform/lib/routes.js";
import { useSlackInstallAvailability } from "../../slack/api/queries.js";
import { useUsageInspectAvailability } from "../../usage/api/queries.js";

const BASE_TABS: readonly { value: SettingsTab; label: string }[] = [
  { value: "account", label: "Account" },
  { value: "appearance", label: "Appearance" },
  { value: "providers", label: "Providers" },
  { value: "profiles", label: "Profiles" },
  { value: "connections", label: "Connections" },
  { value: "api-keys", label: "API keys" },
  { value: "usage", label: "Usage" },
  { value: "schedules", label: "Schedules" },
];

type GatedTab = "features" | "slack-workspaces" | "analytics" | "operator";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the settings tabs the signed-in person sees, in
 * order: the base tabs, then each gated tab once its availability answers yes,
 * then About. Settings and the command palette list the same tabs. A gated tab
 * is settled hidden once its availability has answered no, so a link to it can
 * fall back to Account. Experimental features shows while the install leaves a
 * switch of that level to the person. Internal features is never listed: only
 * its own address opens it.
 */
export function useSettingsTabs() {
  const install = useInstallCapabilities();
  const slackInstall = useSlackInstallAvailability();
  const usageInspect = useUsageInspectAvailability();
  const operatorAccess = useOperatorAvailability();
  const shown: Record<GatedTab, boolean> = {
    features: offeredFeatures("experimental", install.data).length > 0,
    "slack-workspaces": slackInstall.data === true,
    analytics: usageInspect.data === true,
    operator: operatorAccess.data?.isOperator === true,
  };
  const answered: Record<GatedTab, boolean> = {
    features: install.isSuccess,
    "slack-workspaces": slackInstall.isSuccess,
    analytics: usageInspect.isSuccess,
    operator: operatorAccess.isSuccess,
  };
  const tabs = [
    ...BASE_TABS,
    ...(shown["slack-workspaces"]
      ? [{ value: "slack-workspaces" as const, label: "Slack workspaces" }]
      : []),
    ...(shown.analytics
      ? [{ value: "analytics" as const, label: "Analytics" }]
      : []),
    ...(shown.operator
      ? [{ value: "operator" as const, label: "Operator" }]
      : []),
    ...(shown.features
      ? [{ value: "features" as const, label: "Experimental features" }]
      : []),
    { value: "about" as const, label: `About ${getBrand().name}` },
  ];
  const gated = (tab: SettingsTab): tab is GatedTab => tab in shown;
  return {
    tabs,
    hidden: (tab: SettingsTab) => gated(tab) && !shown[tab],
    settledHidden: (tab: SettingsTab) =>
      gated(tab) && !shown[tab] && answered[tab],
  };
}
