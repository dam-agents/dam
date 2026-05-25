import { LogOut, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

import { getUser, logout } from "../../../auth.js";
import { useStore } from "../../../store.js";

type Tab = "appearance" | "account";

const tabs: { id: Tab; label: string }[] = [
  { id: "account", label: "Account" },
  { id: "appearance", label: "Appearance" },
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
  const [activeTab, setActiveTab] = useState<Tab>("account");
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const setView = useStore((s) => s.setView);
  const user = getUser();

  return (
    <div className="flex gap-6 md:gap-10 flex-col md:flex-row">
      {/* Tab sidebar */}
      <div className="flex md:flex-col gap-1 md:w-[180px] shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 text-[14px] font-medium rounded-lg text-left transition-colors ${activeTab === tab.id ? "text-accent bg-accent-light" : "text-text-secondary hover:text-text hover:bg-surface-raised"}`}
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
            <p className="text-[14px] text-text-secondary mb-6">
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
                      className={`flex flex-col items-start gap-2 p-4 rounded-xl border-2 transition-all ${theme === value ? "border-accent bg-accent-light shadow-brutal-sm" : "border-border-light hover:border-text-muted bg-surface"}`}
                    >
                      <div
                        className={`h-9 w-9 rounded-lg flex items-center justify-center ${theme === value ? "bg-accent text-white" : "bg-surface-raised text-text-secondary"}`}
                      >
                        <Icon size={18} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-text">
                          {label}
                        </div>
                        <div className="text-[12px] text-text-muted mt-0.5">
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
            <p className="text-[14px] text-text-secondary mb-6">
              Manage your account and session.
            </p>

            <div className="flex items-center gap-4 p-4 rounded-xl border-2 border-border-light bg-surface">
              <div className="h-10 w-10 rounded-full bg-accent-light flex items-center justify-center text-accent font-bold text-[16px]">
                {(user?.profile.preferred_username ??
                  user?.profile.sub ??
                  "?")[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-medium text-text truncate">
                  {user?.profile.preferred_username ??
                    user?.profile.sub ??
                    "Unknown"}
                </div>
                <div className="text-[12px] text-text-muted">Signed in</div>
              </div>
              <button
                onClick={() => logout()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-text-secondary hover:text-danger rounded-lg hover:bg-danger-light transition-colors"
              >
                <LogOut size={14} />
                Log out
              </button>
            </div>

            <div className="mt-6">
              <button
                onClick={() => setView("terms")}
                className="text-[13px] font-medium text-text-secondary hover:text-text underline underline-offset-2"
              >
                View Terms of Use
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
