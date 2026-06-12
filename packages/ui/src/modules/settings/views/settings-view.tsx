import {
  Asleep as Moon,
  Light as Sun,
  Logout as LogOut,
  Screen as Monitor,
} from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import { getUser, logout } from "../../../auth.js";
import { useStore } from "../../../store.js";
import { ConnectionsView } from "../../connections/views/connections-view.js";
import type { SettingsTab } from "../../platform/lib/routes.js";
import { useAppVersion } from "../api/queries.js";
import { ProvidersView } from "./providers-view.js";

const tabs: { id: SettingsTab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
  { id: "providers", label: "Providers" },
  { id: "connections", label: "Connections" },
];

const themeOptions = [
  {
    value: "light" as const,
    icon: Sun,
    label: "Light",
    description: "Light background with dark text",
  },
  {
    value: "dark" as const,
    icon: Moon,
    label: "Dark",
    description: "Dark background with light text",
  },
  {
    value: "system" as const,
    icon: Monitor,
    label: "System",
    description: "Follow your operating system setting",
  },
];

export function SettingsView() {
  const activeTab = useStore((s) => s.settingsTab);
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setView = useStore((s) => s.setView);
  const user = getUser();
  const { data: appVersion } = useAppVersion();

  return (
    <div className="flex gap-6 md:gap-10 flex-col md:flex-row">
      {/* Tab sidebar */}
      <div className="flex md:flex-col gap-1 md:w-[180px] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => navigateToSettings(tab.id)}
            className={cn(
              "px-3 py-2 text-[14px] font-medium rounded-lg text-left transition-colors",
              activeTab === tab.id
                ? "text-primary bg-primary/10"
                : "text-foreground/80 hover:text-foreground hover:bg-muted",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-w-0">
        {activeTab === "appearance" && (
          <div className="anim-in">
            <h2 className="text-[18px] font-bold mb-1">Appearance</h2>
            <p className="text-[14px] text-foreground/80 mb-6">
              Customize the look and feel of the interface.
            </p>

            {/* Theme selector */}
            <div className="mb-8">
              <h3 className="text-[14px] font-semibold mb-3">Theme</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {themeOptions.map(
                  ({ value, icon: Icon, label, description }) => (
                    <button
                      key={value}
                      onClick={() => setTheme(value)}
                      className={cn(
                        "flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all",
                        theme === value
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-border hover:border-muted-foreground bg-card",
                      )}
                    >
                      <div
                        className={cn(
                          "h-9 w-9 rounded-lg flex items-center justify-center",
                          theme === value
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-foreground/80",
                        )}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-foreground">
                          {label}
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">
                          {description}
                        </div>
                      </div>
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "account" && (
          <div className="anim-in">
            <h2 className="text-[18px] font-bold mb-1">Account</h2>
            <p className="text-[14px] text-foreground/80 mb-6">
              Manage your account and session.
            </p>

            <Card className="flex items-center gap-4 p-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-[16px]">
                {(user?.profile.preferred_username ??
                  user?.profile.sub ??
                  "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-foreground truncate">
                  {user?.profile.preferred_username ??
                    user?.profile.sub ??
                    "Unknown"}
                </div>
                <div className="text-[12px] text-muted-foreground">
                  Signed in
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() => logout()}
                className="text-foreground/80 hover:text-destructive hover:bg-destructive/10"
              >
                <LogOut size={14} />
                Log out
              </Button>
            </Card>

            <div className="mt-6">
              <Button variant="link" onClick={() => setView("terms")}>
                View Terms of Use
              </Button>
            </div>

            {appVersion && (
              <div className="mt-6 text-[12px] text-muted-foreground break-all">
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
      </div>
    </div>
  );
}
