import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Modal } from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import { useStartMcpOAuth } from "../api/mutations.js";

interface Props {
  initialUrl?: string;
  onCancel: () => void;
}

export function AddMcpForm({ initialUrl = "", onCancel }: Props) {
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
    <Modal widthClass="w-[480px]">
      <div className="flex flex-col gap-5 p-5 md:p-7">
        <h2 className="text-[20px] font-bold text-foreground">Connect MCP Server</h2>
        <p className="text-[13px] text-foreground/80">
          Enter the URL of a remote MCP server to connect via OAuth.
        </p>
        <Input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://example.com/mcp"
          autoFocus
        />
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!url.trim() || startMcpOAuth.isPending}
          >
            {startMcpOAuth.isPending ? "..." : "Connect"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
