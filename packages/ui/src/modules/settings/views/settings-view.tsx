import { Asleep, Light, Logout, Screen } from "@carbon/icons-react";
import {
  ColorContrast,
  FoundationModel,
  UserProfile,
} from "@carbon/pictograms-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CardButton } from "@/components/ui/card-button";
import { PageHeader } from "@/components/ui/page-header";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { getUser, logout } from "../../../auth.js";
import { getBrand } from "../../../brand.js";
import { useStore } from "../../../store.js";
import { ApiKeysList } from "../../api-keys/components/api-keys-list.js";
import { ConnectionsView } from "../../connections/views/connections-view.js";
import { useFeatures } from "../../features/api/queries.js";
import { FeaturesTab } from "../../features/components/features-tab.js";
import { UsageView } from "../../metrics/views/usage-view.js";
import { useOperatorAvailability } from "../../operator/api/queries.js";
import { OperatorView } from "../../operator/views/operator-view.js";
import { routeToPath, type SettingsTab } from "../../platform/lib/routes.js";
import { ProfileSection } from "../../profiles/components/profile-section.js";
import { ProviderSection } from "../../providers/components/provider-section.js";
import { OwnerSchedulesView } from "../../schedules/views/owner-schedules-view.js";
import { useSlackInstallAvailability } from "../../slack/api/queries.js";
import { SlackWorkspacesView } from "../../slack/views/slack-workspaces-view.js";
import { useUsageInspectAvailability } from "../../usage/api/queries.js";
import { UsageAnalyticsView } from "../../usage/views/usage-analytics-view.js";
import { AboutTab } from "../components/about-tab.js";
import { ToolActivitySetting } from "../components/tool-activity-setting.js";

const baseTabs: readonly TabDef<SettingsTab>[] = [
  { value: "account", label: "Account" },
  { value: "appearance", label: "Appearance" },
  { value: "providers", label: "Providers" },
  { value: "connections", label: "Connections" },
  { value: "api-keys", label: "API keys" },
  { value: "usage", label: "Usage" },
  { value: "schedules", label: "Schedules" },
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
  const { data: flags, isSuccess: flagsLoaded } = useFeatures();
  const featuresMenuRevealed = useStore((s) => s.featuresMenuRevealed);
  const showFeatures =
    featuresMenuRevealed || Object.values(flags ?? {}).some(Boolean);
  const slackInstall = useSlackInstallAvailability();
  const showSlackWorkspaces = slackInstall.data === true;
  const usageInspect = useUsageInspectAvailability();
  const showAnalytics = usageInspect.data === true;
  const operatorAccess = useOperatorAvailability();
  const showOperator = operatorAccess.data?.isOperator === true;
  const tabs = [
    ...baseTabs,
    ...(showSlackWorkspaces
      ? [{ value: "slack-workspaces" as const, label: "Slack workspaces" }]
      : []),
    ...(showAnalytics
      ? [{ value: "analytics" as const, label: "Analytics" }]
      : []),
    ...(showOperator
      ? [{ value: "operator" as const, label: "Operator" }]
      : []),
    ...(showFeatures
      ? [{ value: "features" as const, label: "Experimental features" }]
      : []),
    { value: "about" as const, label: `About ${getBrand().name}` },
  ];
  const rawTab = useStore((s) => s.settingsTab);
  const hiddenTab =
    (rawTab === "features" && !showFeatures) ||
    (rawTab === "slack-workspaces" && !showSlackWorkspaces) ||
    (rawTab === "analytics" && !showAnalytics) ||
    (rawTab === "operator" && !showOperator);
  const activeTab = hiddenTab ? "account" : rawTab;
  const tabStrip = useRef<HTMLDivElement>(null);
  const hiddenTabSettled =
    (rawTab === "features" && !showFeatures && flagsLoaded) ||
    (rawTab === "slack-workspaces" &&
      slackInstall.isSuccess &&
      !showSlackWorkspaces) ||
    (rawTab === "analytics" && usageInspect.isSuccess && !showAnalytics) ||
    (rawTab === "operator" && operatorAccess.isSuccess && !showOperator);
  useEffect(() => {
    if (!hiddenTabSettled) return;
    history.replaceState(
      history.state,
      "",
      routeToPath({ view: "settings", settingsTab: "account" }),
    );
    useStore.setState({ settingsTab: "account" });
  }, [hiddenTabSettled]);
  useEffect(() => {
    tabStrip.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeTab]);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const user = getUser();

  return (
    <div className="flex gap-6 md:gap-10 flex-col md:flex-row md:pt-5">
      <div ref={tabStrip} className="contents">
        <Tabs
          ariaLabel="Settings sections"
          tabs={tabs}
          value={activeTab}
          onValueChange={navigateToSettings}
          variant="pill"
          size="sm"
          orientation="vertical"
          className="flex-row overflow-x-auto px-1.5 py-1 [mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)] [&>button]:shrink-0 md:flex-col md:overflow-x-visible md:px-0 md:py-0 md:w-[180px] md:[mask-image:none] shrink-0"
        />
      </div>

      <div key={activeTab} className="anim-in min-w-0 max-w-2xl flex-1">
        {activeTab === "appearance" && (
          <div>
            <PageHeader
              pictogram={<ColorContrast aria-hidden />}
              title="Appearance"
              description="Choose how the interface looks."
            />

            <div className="mb-8">
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

            <ToolActivitySetting />
          </div>
        )}

        {activeTab === "api-keys" && <ApiKeysList />}

        {activeTab === "account" && (
          <div>
            <PageHeader
              pictogram={<UserProfile aria-hidden />}
              title="Account"
              description="See who you are signed in as, and sign out."
            />

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
              <Button variant="ghost" onClick={() => logout()} tone="danger">
                <Logout size={14} />
                Log out
              </Button>
            </Card>
          </div>
        )}

        {activeTab === "providers" && (
          <div>
            <div>
              <PageHeader
                pictogram={<FoundationModel aria-hidden />}
                title="Providers"
                description="Connect an LLM provider to give agents access to its models."
              />

              <section className="mb-8">
                <ProviderSection />
              </section>

              <ProfileSection />
            </div>
          </div>
        )}

        {activeTab === "connections" && (
          <div>
            <ConnectionsView />
          </div>
        )}

        {activeTab === "usage" && (
          <div>
            <UsageView />
          </div>
        )}

        {activeTab === "schedules" && <OwnerSchedulesView />}

        {activeTab === "slack-workspaces" && <SlackWorkspacesView />}

        {activeTab === "analytics" && <UsageAnalyticsView />}
        {activeTab === "operator" && <OperatorView />}

        {activeTab === "features" && <FeaturesTab />}

        {activeTab === "about" && <AboutTab />}
      </div>
    </div>
  );
}
