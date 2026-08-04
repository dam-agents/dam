import { Asleep, Light, Logout, Screen } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { PageHeader } from "@/components/ui/page-header";
import { SectionLabel } from "@/components/ui/section-label";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { getUser, logout } from "../../../auth.js";
import { useStore } from "../../../store.js";
import { ApiKeysList } from "../../api-keys/components/api-keys-list.js";
import { ConnectionsView } from "../../connections/views/connections-view.js";
import { useFeatures } from "../../features/api/queries.js";
import { FeaturesTab } from "../../features/components/features-tab.js";
import {
  isFeaturesMenuRevealed,
  setFeaturesMenuRevealed,
} from "../../features/lib/menu-reveal.js";
import { UsageView } from "../../metrics/views/usage-view.js";
import type { SettingsTab } from "../../platform/lib/routes.js";
import { useAppVersion } from "../api/queries.js";
import { ProvidersView } from "./providers-view.js";

const baseTabs: readonly TabDef<SettingsTab>[] = [
  { value: "account", label: "Account" },
  { value: "appearance", label: "Appearance" },
  { value: "providers", label: "Providers" },
  { value: "connections", label: "Connections" },
  { value: "api-keys", label: "API keys" },
  { value: "usage", label: "Usage" },
];

const themeOptions = [
  {
    value: "light" as const,
    icon: Light,
    label: "Light",
    description: "Light background with dark text",
  },
  {
    value: "dark" as const,
    icon: Asleep,
    label: "Dark",
    description: "Dark background with light text",
  },
  {
    value: "system" as const,
    icon: Screen,
    label: "System",
    description: "Follow your operating system setting",
  },
];

export function SettingsView() {
  const { data: flags } = useFeatures();
  // The Features tab stays reachable once revealed here, and for anyone who
  // already has a flag on (so it can be found again on another browser).
  const showFeatures =
    isFeaturesMenuRevealed() || Object.values(flags ?? {}).some(Boolean);
  const tabs = [
    ...baseTabs,
    ...(showFeatures
      ? [{ value: "features" as const, label: "Experimental features" }]
      : []),
  ];
  const rawTab = useStore((s) => s.settingsTab);
  const activeTab = rawTab === "features" && !showFeatures ? "account" : rawTab;
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setView = useStore((s) => s.setView);
  const user = getUser();
  const { data: appVersion } = useAppVersion();
  const [versionTaps, setVersionTaps] = useState(0);

  // Hidden: five taps on the version string reveals the Features tab —
  // the per-user toggles for pre-release surfaces live there.
  const onVersionTap = () => {
    if (versionTaps + 1 < 5) {
      setVersionTaps(versionTaps + 1);
      return;
    }
    setVersionTaps(0);
    const revealed = !isFeaturesMenuRevealed();
    setFeaturesMenuRevealed(revealed);
    navigateToSettings(revealed ? "features" : "account");
  };

  return (
    <div className="flex gap-6 md:gap-10 flex-col md:flex-row">
      <Tabs
        ariaLabel="Settings sections"
        tabs={tabs}
        value={activeTab}
        onValueChange={navigateToSettings}
        variant="pill"
        size="sm"
        orientation="vertical"
        // Mobile lays the strip out as a row. It owns its horizontal overflow
        // so a long tab set scrolls the strip instead of the whole view, the
        // triggers keep their full label instead of shrinking into wraps, and
        // the vertical padding leaves room for a focus ring inside the scroll
        // box. Desktop stays the plain vertical sidebar.
        className="flex-row overflow-x-auto py-1 [&>button]:shrink-0 md:flex-col md:overflow-x-visible md:py-0 md:w-[180px] shrink-0"
      />

      <div className="flex-1 min-w-0">
        {activeTab === "appearance" && (
          <div className="anim-in">
            <PageHeader
              title="Appearance"
              description="Customize the look and feel of the interface."
            />

            {/* Theme selector */}
            <div className="mb-8">
              <SectionLabel spaced>Theme</SectionLabel>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {themeOptions.map(
                  ({ value, icon: Icon, label, description }) => (
                    <CardButton
                      key={value}
                      onClick={() => setTheme(value)}
                      selected={theme === value}
                      className="flex flex-col items-start gap-2.5 p-4"
                    >
                      <Icon
                        size={22}
                        className={cn(
                          "shrink-0",
                          theme === value
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      />
                      <span>
                        <span className="block text-base font-medium leading-[1.2] text-foreground">
                          {label}
                        </span>
                        <span className="mt-1 block text-sm text-muted-foreground">
                          {description}
                        </span>
                      </span>
                    </CardButton>
                  ),
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "api-keys" && <ApiKeysList />}

        {activeTab === "account" && (
          <div className="anim-in">
            <PageHeader
              title="Account"
              description="Manage your account and session."
            />

            <SectionLabel spaced>Profile</SectionLabel>
            <Card className="flex items-center gap-4 p-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base">
                {(user?.profile.preferred_username ??
                  user?.profile.sub ??
                  "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {user?.profile.preferred_username ??
                    user?.profile.sub ??
                    "Unknown"}
                </div>
                <div className="text-xs text-muted-foreground">Signed in</div>
              </div>
              <Button
                variant="ghost"
                onClick={() => logout()}
                className="text-foreground/80 hover:text-destructive hover:bg-destructive/10"
              >
                <Logout size={14} />
                Log out
              </Button>
            </Card>

            <div className="mt-6">
              <Button variant="link" onClick={() => setView("terms")}>
                View Terms of Use
              </Button>
            </div>

            {appVersion && (
              <div
                onClick={onVersionTap}
                className="mt-6 text-xs text-muted-foreground break-all select-none"
              >
                Version {appVersion}
              </div>
            )}
          </div>
        )}

        {activeTab === "providers" && (
          <div className="anim-in">
            <ProvidersView />
          </div>
        )}

        {activeTab === "connections" && (
          <div className="anim-in">
            <ConnectionsView />
          </div>
        )}

        {activeTab === "usage" && (
          <div className="anim-in">
            <UsageView />
          </div>
        )}

        {activeTab === "features" && <FeaturesTab />}
      </div>
    </div>
  );
}
