import type { SettingsTab, View } from "../modules/platform/lib/routes.js";

const SETTINGS_TAB_TITLE: Record<SettingsTab, string> = {
  account: "Account",
  appearance: "Appearance",
  providers: "Providers",
  connections: "Connections",
  "api-keys": "API keys",
  usage: "Usage",
  schedules: "Schedules",
  "slack-workspaces": "Slack workspaces",
  analytics: "Analytics",
  features: "Experimental features",
  about: "About",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: The browser tab title for the current view, as
 * "<page> · <parent> · <brand name>", so several open tabs can be told apart.
 * Names that have not loaded yet are left out rather than shown as ids.
 */
export function documentTitle(
  route: {
    view: View;
    settingsTab: SettingsTab;
    sandboxSectionTitle?: string;
  },
  names: { agent?: string; session?: string | null; kit?: string },
  brandName: string,
): string {
  const parts: (string | null | undefined)[] = (() => {
    switch (route.view) {
      case "home":
        return ["Home"];
      case "artifacts":
        return ["Artifacts"];
      case "starter-kits":
        return ["Starter kits"];
      case "chat":
        return [names.session, names.agent];
      case "settings":
        return [SETTINGS_TAB_TITLE[route.settingsTab], "Settings"];
      case "sandbox-home":
        return [route.sandboxSectionTitle, names.agent];
      case "starter-kit":
        return [names.kit ?? "Starter kit"];
      case "terms":
        return ["Terms of Use"];
      case "telegram-bind":
        return ["Connect Telegram"];
      case "slack-bind":
        return ["Connect Slack"];
      case "analytics":
        return ["Usage analytics"];
      case "not-found":
        return ["Page not found"];
    }
  })();
  return [...parts, brandName].filter(Boolean).join(" · ");
}
