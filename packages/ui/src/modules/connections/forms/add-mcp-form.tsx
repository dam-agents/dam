import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { useStore } from "../../../store.js";
import { useStartMcpOAuth } from "../api/mutations.js";

interface Props {
  initialUrl?: string;
  onCancel: () => void;
  /** Optional handler for returning to a parent picker (the connection
   *  chooser). When provided, a "Back" button is rendered alongside the
   *  Cancel/Connect actions. */
  onBack?: () => void;
}

export function AddMcpForm({ initialUrl = "", onCancel, onBack }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const showToast = useStore((s) => s.showToast);
  const startMcpOAuth = useStartMcpOAuth();

  const submit = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    startMcpOAuth.mutate(trimmed, {
      onSuccess: (data) => {
        if (data.error) {
          showToast({ kind: "error", message: data.error });
          return;
        }
        if (data.authUrl) {
          sessionStorage.setItem("platform-return-view", "connections");
          window.location.href = data.authUrl;
        }
      },
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Connect MCP Server</DialogTitle>
          <DialogDescription>
            Enter the URL of a remote MCP server to connect via OAuth.
          </DialogDescription>
        </DialogHeader>

        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://example.com/mcp"
          autoFocus
        />

        <DialogFooter>
          {onBack && (
            <Button type="button" variant="outline" onClick={onBack}>
              ← Back
            </Button>
          )}
          <Button
            type="button"
            onClick={submit}
            disabled={!url.trim() || startMcpOAuth.isPending}
          >
            {startMcpOAuth.isPending ? "..." : "Connect"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
