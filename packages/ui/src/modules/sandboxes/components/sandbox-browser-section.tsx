import { Restart, TrashCan } from "@carbon/icons-react";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { RowActionsMenu } from "@/components/ui/row-actions-menu";
import { emitToast } from "@/lib/toast";

import { useStore } from "../../../store.js";

type MockState = "default" | "empty" | "not-started" | "cleared";

interface SignedInSite {
  host: string;
  lastUsed: string;
}

const MOCK_SITES: SignedInSite[] = [
  { host: "github.com", lastUsed: "2 hours ago" },
  { host: "ibm.box.com", lastUsed: "Yesterday" },
  { host: "w3.ibm.com", lastUsed: "3 days ago" },
];

export function SandboxBrowserSection(props: {
  agentId: string;
  header: (actions?: ReactNode) => ReactNode;
}) {
  const showConfirm = useStore((s) => s.showConfirm);
  const [mockState, setMockState] = useState<MockState>("default");
  const [sites, setSites] = useState<SignedInSite[]>(MOCK_SITES);

  const handleClear = async () => {
    const ok = await showConfirm(
      "Sign-ins, cookies and site data stored in this agent's browser are deleted.",
      "Clear browser data?",
      { kind: "destructive", confirmLabel: "Clear data" },
    );
    if (ok) {
      setSites([]);
      setMockState("cleared");
      emitToast({ kind: "success", message: "Browser data cleared" });
    }
  };

  const handleRemove = (host: string) => {
    setSites((prev) => prev.filter((s) => s.host !== host));
  };

  const switchState = (next: MockState) => {
    setMockState(next);
    if (next === "default") setSites(MOCK_SITES);
    else if (next === "empty" || next === "cleared") setSites([]);
  };

  if (mockState === "not-started") {
    return (
      <div className="flex flex-col gap-3">
        <MockStateSwitcher value={mockState} onChange={switchState} />
        {props.header()}
        <p className="text-sm text-muted-foreground">
          The browser starts the first time this agent opens a page.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <MockStateSwitcher value={mockState} onChange={switchState} />
      {props.header()}

      <p className="text-sm text-muted-foreground">Signed-in sites</p>
      <Card className="divide-y divide-border overflow-hidden">
        {sites.length === 0 ? (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            No sign-ins yet.
          </p>
        ) : (
          sites.map((site) => (
            <div
              key={site.host}
              className="flex items-center justify-between px-4 py-2.5"
            >
              <div className="flex flex-col gap-0.5">
                <code className="text-sm text-foreground">{site.host}</code>
                <span className="text-xs text-muted-foreground">
                  Last used {site.lastUsed}
                </span>
              </div>
              <RowActionsMenu label={`Actions for ${site.host}`} dense>
                <DropdownMenuItem
                  tone="danger"
                  onSelect={() => handleRemove(site.host)}
                >
                  <TrashCan size={13} /> Remove
                </DropdownMenuItem>
              </RowActionsMenu>
            </div>
          ))
        )}
      </Card>

      <div className="flex gap-2">
        <Button variant="destructive" size="sm" onClick={handleClear}>
          Clear browser data
        </Button>
        <Button variant="secondary" size="sm" onClick={() => {}}>
          <Restart size={16} />
          Restart browser
        </Button>
      </div>
    </div>
  );
}

function MockStateSwitcher({
  value,
  onChange,
}: {
  value: MockState;
  onChange: (v: MockState) => void;
}) {
  const states: { value: MockState; label: string }[] = [
    { value: "default", label: "3 sites" },
    { value: "empty", label: "No sign-ins" },
    { value: "not-started", label: "Not started" },
    { value: "cleared", label: "After clear" },
  ];
  return (
    <div className="flex gap-1">
      {states.map((s) => (
        <Button
          key={s.value}
          variant={value === s.value ? "secondary" : "ghost"}
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground"
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}
