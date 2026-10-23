import { TRPCClientError } from "@trpc/client";
import type { ReactNode } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Input } from "@/components/ui/input";

interface Field {
  label: string;
  hint: ReactNode;
  value: string;
  placeholder?: string;
  error?: string;
  autoFocus?: boolean;
  inputMode?: "decimal";
  onChange: (text: string) => void;
}

interface Props {
  title: string;
  subtitle: string;
  user: {
    value: string;
    valid: boolean;
    onChange: (text: string) => void;
  } | null;
  failure: unknown;
  errorCopy: {
    removedMeanwhile: string;
    saveFailed: string;
    showServerMessage: boolean;
  };
  fields: Field[];
  pending: boolean;
  canSave: boolean;
  onSave: () => void;
  onClose: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the operator's per-user override form. A new entry takes the user's email; an existing one is keyed by it, so `user` is null and the email only shows in the subtitle. An empty field means the install's default, so the caller decides what a change sends. The two failures an override can meet - the entry was removed meanwhile, or the server refused the input - map here, so both override forms say the same thing, and `showServerMessage` picks a rejected input's own message over the generic one.
export function OperatorOverrideDialog({
  title,
  subtitle,
  user,
  failure,
  errorCopy,
  fields,
  pending,
  canSave,
  onSave,
  onClose,
}: Props) {
  const code =
    failure instanceof TRPCClientError ? failure.data?.code : undefined;
  const message = failure instanceof Error ? failure.message : undefined;
  const emailError =
    code === "NOT_FOUND" && user
      ? message
      : user && user.value.trim() !== "" && !user.valid
        ? "Enter an email address."
        : undefined;
  const formError = !failure
    ? undefined
    : code === "NOT_FOUND"
      ? user
        ? undefined
        : errorCopy.removedMeanwhile
      : code === "BAD_REQUEST" && errorCopy.showServerMessage
        ? message
        : errorCopy.saveFailed;

  return (
    <Modal size="sm" onClose={pending ? undefined : onClose}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSave || pending) return;
          onSave();
        }}
      >
        <DialogHeader
          title={title}
          subtitle={subtitle}
          onClose={onClose}
          closeDisabled={pending}
        />
        <DialogBody className="flex flex-col gap-4">
          {user && (
            <FormField label="User's email" error={emailError}>
              <Input
                autoFocus
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                variant={emailError ? "invalid" : "standard"}
                aria-invalid={emailError !== undefined}
                value={user.value}
                onChange={(event) => user.onChange(event.target.value)}
              />
            </FormField>
          )}
          {fields.map((field) => (
            <FormField
              key={field.label}
              label={field.label}
              hint={field.hint}
              error={field.error}
            >
              <Input
                autoFocus={field.autoFocus}
                autoComplete="off"
                inputMode={field.inputMode}
                placeholder={field.placeholder}
                variant={field.error ? "invalid" : "standard"}
                className="w-36 font-mono"
                aria-invalid={field.error !== undefined}
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
              />
            </FormField>
          ))}
          {formError && (
            <p role="alert" className="text-sm text-danger">
              {formError}
            </p>
          )}
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          cancelDisabled={pending}
          label="Save"
          pendingLabel="Saving…"
          pending={pending}
          disabled={!canSave}
        />
      </form>
    </Modal>
  );
}
