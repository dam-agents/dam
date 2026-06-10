import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { useTestAnthropic } from "../../../secrets/api/mutations.js";
import { CardIcon } from "../shared/card-icon.js";
import { IconButton } from "../shared/icon-button.js";
import {
  anthropicCredentialSchema,
  type AnthropicCredentialValues,
} from "./credential-schema.js";
import { type Mode, MODE_KEYS, MODES, stripWhitespace } from "./modes.js";

export function AnthropicForm({
  variant,
  initialMode,
  onSave,
  onCancel,
}: {
  variant: "wizard" | "edit";
  initialMode: Mode;
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

  // Watching mode + value clears the test result when either changes — a stale
  // green check after the user types something different is worse than no
  // result at all. Switching mode also has to re-trigger value validation: the
  // mismatch lives on `value` via cross-field refinement, and RHF only clears
  // errors on the field that actually changed.
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
    <Card className="anim-in">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <CardIcon provider="anthropic" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] font-bold text-foreground">
              Anthropic
            </div>
            <div className="text-[12px] text-muted-foreground">
              {isEdit
                ? "Pick mode and paste a new credential to replace the existing one."
                : "Required for Claude Code agents. Pick the mode that matches your credential."}
            </div>
          </div>
          {onCancel && (
            <IconButton onClick={onCancel} title="Cancel" hoverTone="neutral">
              <X size={13} />
            </IconButton>
          )}
        </div>

        <Controller
          control={control}
          name="mode"
          render={({ field }) => (
            <ModeToggle mode={field.value} onChange={field.onChange} />
          )}
        />

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
            title="Verify the credential with Anthropic"
            className="shrink-0"
          >
            {testing ? "..." : "Test"}
          </Button>
          <Button type="submit" disabled={submitDisabled} className="shrink-0">
            {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
          </Button>
        </div>

        {/* Mismatch errors live on the value field; "Required" is suppressed
            until the user actually types so the form doesn't yell on first paint. */}
        {errors.value &&
          value.length > 0 &&
          errors.value.message !== "Required" && (
            <div className="text-[12px] font-medium text-destructive">
              {errors.value.message}
            </div>
          )}
        {!errors.value && testResult?.ok && (
          <div className="text-[12px] font-medium text-success flex items-center gap-1.5">
            <Check size={13} /> Credential is valid.
          </div>
        )}
        {!errors.value && testResult && !testResult.ok && (
          <div className="text-[12px] font-medium text-destructive">
            {testResult.message}
          </div>
        )}
      </form>
    </Card>
  );
}

function QuickSetupHint() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText("claude setup-token");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="text-[13px] text-foreground/80">
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
          title="Copy command"
        >
          {copied ? (
            <Check size={12} className="text-success" />
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
    <div className="flex items-center gap-1 border-b">
      {MODE_KEYS.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`h-10 px-4 text-[13px] font-semibold border-b-2 -mb-[1px] transition-colors ${
              active
                ? "text-primary border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            }`}
          >
            {MODES[m].label}
          </button>
        );
      })}
    </div>
  );
}
