import { useStore } from "../../../store.js";
import { SandboxListView } from "./sandbox-list-view.js";
import { SandboxTerminalView } from "./sandbox-terminal-view.js";
import { SandboxWizardView } from "./sandbox-wizard-view.js";

export function V2App() {
  const view = useStore((s) => s.view);
  if (view === "v2-new") return <SandboxWizardView />;
  if (view === "v2-terminal") return <SandboxTerminalView />;
  return <SandboxListView />;
}
