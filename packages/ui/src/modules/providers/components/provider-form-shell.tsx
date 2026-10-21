import { Launch } from "@carbon/icons-react";
import type { FormEventHandler, ReactNode } from "react";

import { DialogBody, DialogHeader } from "@/components/modal";
import { externalLinkProps } from "@/lib/external-link";

import type { ProviderPresetType } from "../../../types.js";
import { CardIcon } from "./card-icon.js";

export interface ProviderKeyPage {
  href: string;
  hint: ReactNode;
}

export function ProviderFormShell({
  provider,
  title,
  description,
  keyPage,
  onSubmit,
  onCancel,
  children,
}: {
  provider: ProviderPresetType;
  title: string;
  description: ReactNode;
  keyPage?: ProviderKeyPage;
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
      <DialogBody className="flex flex-col gap-6">
        {keyPage && <ProviderKeyLink {...keyPage} />}
        {children}
      </DialogBody>
    </form>
  );
}

export function ProviderKeyLink({ href, hint }: ProviderKeyPage) {
  return (
    <a
      href={href}
      {...externalLinkProps}
      className="group flex items-start justify-between gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-bold text-foreground">Get your key</span>
        <div className="text-sm text-muted-foreground">{hint}</div>
      </div>
      <Launch
        size={16}
        className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-primary"
      />
    </a>
  );
}

export function stripWhitespace(value: string): string {
  return value.replace(/\s+/g, "");
}
