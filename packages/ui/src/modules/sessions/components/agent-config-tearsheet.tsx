import { Close } from "@carbon/icons-react";
import { useEffect, useState } from "react";

import { Modal } from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import { ScheduleDetail, SkillsDetail } from "./nested-setup-panel.js";
import { SandboxSetupSection } from "./sandbox-setup-section.js";

type Section = "sandbox-setup" | "skills" | "schedule";

const SECTIONS: { id: Section; label: string; summary: string }[] = [
  {
    id: "sandbox-setup",
    label: "Sandbox Setup",
    summary: "DAM Design helper, Claude Code, 3 connections",
  },
  {
    id: "skills",
    label: "Skills",
    summary: "Code Search, File Editor, +6 more",
  },
  {
    id: "schedule",
    label: "Schedules",
    summary: "3 Schedules running",
  },
];

function mapSection(raw: string | null): Section {
  if (raw === "skills") return "skills";
  if (raw === "schedule") return "schedule";
  return "sandbox-setup";
}

export function AgentConfigTearsheet() {
  const setupPanelSection = useStore((s) => s.setupPanelSection);
  const toggleSetupPanel = useStore((s) => s.toggleSetupPanel);
  const [active, setActive] = useState<Section>(mapSection(setupPanelSection));

  useEffect(() => {
    if (setupPanelSection) {
      setActive(mapSection(setupPanelSection));
    }
  }, [setupPanelSection]);

  return (
    <Modal widthClass="w-[90vw] max-w-[1100px]">
      <div className="flex h-[80vh]">
        {/* Left sidebar navigation */}
        <nav className="w-[260px] shrink-0 border-r border-border flex flex-col bg-muted/20">
          {/* Header */}
          <div className="flex items-center px-5 py-4 border-b border-border">
            <span className="text-[15px] font-semibold text-foreground">
              Configurations
            </span>
          </div>

          {/* Nav items */}
          <div className="flex flex-col gap-1 p-3">
            {SECTIONS.map((section) => {
              const isActive = active === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => setActive(section.id)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                    isActive ? "bg-muted" : "hover:bg-muted/50"
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-[13px] block ${
                        isActive
                          ? "font-semibold text-foreground"
                          : "font-medium text-foreground/80"
                      }`}
                    >
                      {section.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate block mt-0.5">
                      {section.summary}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </nav>

        {/* Right content area */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Content header with close button on the right */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <span className="text-[15px] font-semibold text-foreground">
              {SECTIONS.find((s) => s.id === active)?.label}
            </span>
            <button
              type="button"
              onClick={toggleSetupPanel}
              className="text-muted-foreground hover:text-foreground hover:bg-muted transition-colors p-1.5 rounded-md"
            >
              <Close size={16} />
            </button>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-6">
            {active === "sandbox-setup" && <SandboxSetupSection />}
            {active === "skills" && <SkillsDetail />}
            {active === "schedule" && <ScheduleDetail />}
          </div>
        </div>
      </div>
    </Modal>
  );
}
