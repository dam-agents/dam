import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { emitToast, type Toast } from "@/lib/toast";

const KINDS: Toast[] = [
  {
    kind: "success",
    message: "Sharing updated — the public link is live.",
    ttl: 0,
  },
  {
    kind: "error",
    message: "Can't tell which version you edited. Reload and try again.",
    ttl: 0,
  },
  {
    kind: "warning",
    message:
      "Agent created; 2 external skills could not be installed — see the Skills panel.",
    ttl: 0,
  },
  {
    kind: "info",
    message: "Tracking pdf-tools from anthropics/skills",
    ttl: 0,
  },
];

const WITH_ACTION: Toast[] = [
  {
    kind: "success",
    message: "Published pdf-tools",
    action: { label: "View PR", onClick: () => undefined },
    ttl: 0,
  },
];

function EmitOnMount({ toasts }: { toasts: Toast[] }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    toasts.forEach(emitToast);
  }, [toasts]);
  return (
    <div className="flex flex-wrap gap-2 p-6">
      {toasts.map((toast) => (
        <Button
          key={toast.message}
          variant="outline"
          onClick={() => emitToast({ ...toast, ttl: undefined })}
        >
          Show {toast.kind}
        </Button>
      ))}
    </div>
  );
}

const meta = {
  title: "Components/UI/Sonner",
  component: Toaster,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component:
          "The Storybook preview already mounts the real `Toaster`, as the app does. These stories fire toasts through the app's `emitToast`.",
      },
    },
  },
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllKinds: Story = {
  render: () => <EmitOnMount toasts={KINDS} />,
};

export const WithAction: Story = {
  render: () => <EmitOnMount toasts={WITH_ACTION} />,
};
