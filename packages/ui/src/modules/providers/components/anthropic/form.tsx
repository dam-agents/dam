import { Checkmark, Copy } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type TabDef, Tabs } from "@/components/ui/tabs";
import { useCopy } from "@/hooks/use-copy";

import { useTestAnthropic } from "../../../connections/api/mutations.js";
import { ProviderFormShell } from "../provider-form-shell.js";
import {
  anthropicCredentialSchema,
  type AnthropicCredentialValues,
} from "./credential-schema.js";
import { type Mode, MODE_KEYS, MODES, stripWhitespace } from "./modes.js";

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
  const {
    register,
    handleSubmit,
    control,
    watch,
    getValues,
    trigger,
    formState,
  } = useForm<AnthropicCredentialValues>({
    resolver: zodResolver(anthropicCredentialSchema),
    mode: "onChange",
    defaultValues: { mode: initialMode, value: "" },
  });
  const { errors, isSubmitting, isValid } = formState;

  const [testResult, setTestResult] = useState<
    { ok: true } | { ok: false; message: string } | null
  >(null);
  const testTokenRef = useRef(0);
  const testAnthropic = useTestAnthropic();
  const testing = testAnthropic.isPending;

  const mode = watch("mode");
  const value = watch("value");
  useEffect(() => {
    testTokenRef.current++;
    setTestResult(null);
    trigger("value");
  }, [mode, value, trigger]);

  const isEdit = variant === "edit";
  const submitDisabled = isSubmitting || testing || !isValid;

  const onSubmit = handleSubmit(async (values) => {
    await onSave({ mode: values.mode, value: stripWhitespace(values.value) });
  });

  const test = async () => {
    if (submitDisabled) return;
    const { mode, value } = getValues();
    const sanitized = stripWhitespace(value);
    const token = ++testTokenRef.current;
    setTestResult(null);
    try {
      const result = await testAnthropic.mutateAsync({
        value: sanitized,
        envName:
          mode === "api-key" ? "ANTHROPIC_API_KEY" : "CLAUDE_CODE_OAUTH_TOKEN",
      });
      if (token !== testTokenRef.current) return;
      setTestResult(
        result.ok ? { ok: true } : { ok: false, message: result.message },
      );
    } catch {
      if (token !== testTokenRef.current) return;
      setTestResult({ ok: false, message: "Could not verify credential." });
    }
  };

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
          {...register("value")}
        />
        <Button
          type="button"
          variant="outline"
          onClick={test}
          disabled={submitDisabled}
          tooltip="Verify the credential with Anthropic"
          className="shrink-0"
        >
          {testing ? "..." : "Test"}
        </Button>
        <Button type="submit" disabled={submitDisabled} className="shrink-0">
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </Button>
      </div>

      {}
      {errors.value &&
        value.length > 0 &&
        errors.value.message !== "Required" && (
          <div className="text-xs font-medium text-destructive">
            {errors.value.message}
          </div>
        )}
      {!errors.value && testResult?.ok && (
        <div className="text-xs font-medium text-success flex items-center gap-1.5">
          <Checkmark size={13} /> Credential is valid.
        </div>
      )}
      {!errors.value && testResult && !testResult.ok && (
        <div className="text-xs font-medium text-destructive">
          {testResult.message}
        </div>
      )}
    </ProviderFormShell>
  );
}

function QuickSetupHint() {
  const { copy: copyText, copied } = useCopy();
  const copy = () => void copyText("claude setup-token");
  return (
    <div className="text-sm text-foreground/80">
      Run{" "}
      <span className="inline-flex items-center gap-1.5 align-middle">
        <code className="font-mono font-semibold text-primary">
          claude setup-token
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={copy}
          aria-label="Copy command"
          tooltip="Copy command"
        >
          {copied ? (
            <Checkmark size={12} className="text-success" />
          ) : (
            <Copy size={12} />
          )}
        </Button>
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
