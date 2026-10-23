import { Close } from "@carbon/icons-react";
import type { FormEventHandler, ReactNode } from "react";

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
    <form onSubmit={onSubmit} className="flex flex-col gap-6 p-6">
      <div className="flex items-start gap-3">
        <CardIcon provider={provider} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-bold text-foreground">{title}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {description}
          </div>
        </div>
        {onCancel && (
          <IconButton
            onClick={onCancel}
            label="Cancel"
            hoverTone="neutral"
            className="-mt-2 -mr-2 shrink-0"
          >
            <Close size={16} />
          </IconButton>
        )}
      </div>
      {children}
    </form>
  );
}
