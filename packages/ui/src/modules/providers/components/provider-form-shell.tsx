import type { FormEventHandler, ReactNode } from "react";

import { DialogBody, DialogHeader } from "@/components/modal";

import type { ProviderPresetType } from "../../../types.js";
import { CardIcon } from "./card-icon.js";

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
    <form onSubmit={onSubmit} className="contents">
      <DialogHeader
        icon={<CardIcon provider={provider} />}
        title={title}
        subtitle={description}
        onClose={onCancel}
      />
      <DialogBody className="flex flex-col gap-6">{children}</DialogBody>
    </form>
  );
}

export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
