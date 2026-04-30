import { useState } from "react";

import { Modal } from "../../../components/modal.js";
import { useStore } from "../../../store.js";
import { useStartMcpOAuth } from "../api/mutations.js";

const INPUT_CLASS =
  "w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted";

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
          sessionStorage.setItem("humr-return-view", "connections");
          window.location.href = data.authUrl;
        }
      },
    });
  };

  return (
    <Modal widthClass="w-[480px]">
      <div className="flex flex-col gap-5 p-5 md:p-7">
        <h2 className="text-[20px] font-bold text-text">Connect MCP Server</h2>
        <p className="text-[13px] text-text-secondary">
          Enter the URL of a remote MCP server to connect via OAuth.
        </p>
        <input
          className={INPUT_CLASS}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="https://example.com/mcp"
          autoFocus
        />
        <div className="flex justify-end gap-3">
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-border px-5 text-[13px] font-semibold text-text-secondary hover:text-text shadow-brutal-sm"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-brutal h-9 rounded-lg border-2 border-accent-hover bg-accent px-5 text-[13px] font-bold text-white disabled:opacity-40 shadow-brutal-accent"
            onClick={submit}
            disabled={!url.trim() || startMcpOAuth.isPending}
          >
            {startMcpOAuth.isPending ? "..." : "Connect"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
