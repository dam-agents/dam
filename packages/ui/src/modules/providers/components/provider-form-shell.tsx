import { X } from "lucide-react";
import type { FormEventHandler, ReactNode } from "react";

import { Card } from "@/components/ui/card";

import type { ProviderPresetType } from "../../../types.js";
import { CardIcon } from "./card-icon.js";
import { IconButton } from "./icon-button.js";

export function ProviderFormShell({
  provider,
  title,
  description,
  onSubmit,
  onCancel,
  children,
}: {
  provider: ProviderPresetType;
  title: string;
  description: ReactNode;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel?: () => void;
  children: ReactNode;
}) {
  return (
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-6 p-6">
        <div className="flex items-center gap-3">
          <CardIcon provider={provider} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="text-[18px] font-bold text-foreground">{title}</div>
            <div className="text-[14px] text-muted-foreground">
              {description}
            </div>
          </div>
          {onCancel && (
            <IconButton
              onClick={onCancel}
              title="Cancel"
              hoverTone="neutral"
              className="self-start"
            >
              <X size={13} />
            </IconButton>
          )}
        </div>
        {children}
      </form>
    </Card>
  );
}
