import { Launch } from "@carbon/icons-react";
import type { FormEventHandler, ReactNode } from "react";
import type { FieldError, UseFormRegisterReturn } from "react-hook-form";
import { z } from "zod";

import { DialogBody, DialogHeader } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  closeDisabled,
  children,
}: {
  provider: ProviderPresetType;
  title: string;
  description: ReactNode;
  keyPage?: ProviderKeyPage;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onCancel?: () => void;
  closeDisabled?: boolean;
  children: ReactNode;
}) {
  return (
    <form onSubmit={onSubmit} className="contents">
      <DialogHeader
        icon={<CardIcon provider={provider} />}
        title={title}
        subtitle={description}
        onClose={onCancel}
        closeDisabled={closeDisabled}
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

export const requiredSecretSchema = z
  .string()
  .refine((value) => stripWhitespace(value).length > 0, {
    message: "Required",
  });

interface ProviderSecretRowProps {
  register: UseFormRegisterReturn;
  placeholder: string;
  ariaLabel: string;
  isEdit: boolean;
  isSubmitting: boolean;
  submitDisabled: boolean;
  value?: string;
  error?: FieldError;
}

// UNIT_BOUNDARY_DESCRIPTION: the API key row every provider form submits with. A secret cannot be pasted from a password manager or an autofill, so the input opts out of both, and the button says Replace where a key already exists. A key left empty is incomplete rather than wrong, so the Required message stays hidden and the disabled button says it.
export function ProviderSecretRow({
  register,
  placeholder,
  ariaLabel,
  isEdit,
  isSubmitting,
  submitDisabled,
  value,
  error,
}: ProviderSecretRowProps) {
  return (
    <>
      <div className="flex gap-3">
        <Input
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={placeholder}
          aria-label={ariaLabel}
          {...register}
        />
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "Saving…" : isEdit ? "Replace" : "Save"}
        </Button>
      </div>
      {error && value && value.length > 0 && error.message !== "Required" && (
        <div className="text-xs font-medium text-danger">{error.message}</div>
      )}
    </>
  );
}
