import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { type TabDef, Tabs } from "@/components/ui/tabs";

import { ProviderFormShell, stripWhitespace } from "../provider-form-shell.js";
import {
  anthropicCredentialSchema,
  type AnthropicCredentialValues,
} from "./credential-schema.js";
import { type Mode, MODE_KEYS, MODES } from "./modes.js";

const MODE_TABS: readonly TabDef<Mode>[] = MODE_KEYS.map((mode) => ({
  value: mode,
  label: MODES[mode].label,
}));

export function AnthropicForm({
  variant,
  initialMode,
  lockMode = false,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialMode: Mode;
  lockMode?: boolean;
  onSave: (input: { mode: Mode; value: string }) => Promise<void>;
  onCancel?: () => void;
}) {
  const { register, handleSubmit, control, watch, trigger, formState } =
    useForm<AnthropicCredentialValues>({
      resolver: zodResolver(anthropicCredentialSchema),
      mode: "onChange",
      defaultValues: { mode: initialMode, value: "" },
    });
  const { errors, isSubmitting, isValid } = formState;

  const mode = watch("mode");
  const value = watch("value");
  useEffect(() => {
    trigger("value");
  }, [mode, value, trigger]);

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ mode: values.mode, value: stripWhitespace(values.value) });
  });

  return (
    <ProviderFormShell
      provider="anthropic"
      title="Anthropic"
      description={
        isEdit
          ? lockMode
            ? `Paste a new ${MODES[initialMode].label} credential to replace the existing one.`
            : "Pick mode and paste a new credential to replace the existing one."
          : "Required for Claude Code agents. Pick the mode that matches your credential."
      }
      keyPage={MODES[mode].keyPage}
      onSubmit={onSubmit}
      onCancel={onCancel}
    >
      {lockMode ? (
        <div className="flex items-center gap-4 border-b border-border">
          <span className="-mb-px flex h-10 items-center border-b-2 border-foreground px-4 text-sm font-medium text-foreground">
            {MODES[initialMode].label}
          </span>
        </div>
      ) : (
        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <ModeToggle mode={field.value} onChange={field.onChange} />
          )}
        />
      )}

      {mode === "oauth" && <QuickSetupHint />}

      <div className="flex gap-3">
        <Input
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={MODES[mode].placeholder}
          aria-label={`Anthropic ${MODES[mode].label}`}
          {...register("value")}
        />
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "Saving…" : isEdit ? "Replace" : "Save"}
        </Button>
      </div>

      {}
      {errors.value &&
        value.length > 0 &&
        errors.value.message !== "Required" && (
          <div className="text-xs font-medium text-danger">
            {errors.value.message}
          </div>
        )}
    </ProviderFormShell>
  );
}

function QuickSetupHint() {
  return (
    <div className="text-sm text-foreground/80">
      Run{" "}
      <span className="inline-flex items-center gap-1.5 align-middle">
        <code className="font-mono font-semibold text-primary">
          claude setup-token
        </code>
        <CopyButton value="claude setup-token" label="Copy command" />
      </span>{" "}
      on your own machine (with Claude Code installed) to generate a token.
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
}) {
  return (
    <Tabs
      ariaLabel="Credential mode"
      tabs={MODE_TABS}
      value={mode}
      onValueChange={onChange}
      size="sm"
    />
  );
}
