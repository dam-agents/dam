import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";

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
    <form
      onSubmit={onSubmit}
      className={`rounded-xl border-2 p-5 anim-in flex flex-col gap-4 ${
        isEdit
          ? "border-accent bg-accent-light shadow-brutal-accent"
          : "border-warning bg-warning-light shadow-brutal"
      }`}
    >
      <div className="flex items-center gap-3">
        <CardIcon variant={isEdit ? "accent" : "warning"} />
        <div className="flex-1 min-w-0">
          <div className="text-[15px] font-bold text-text">Anthropic</div>
          <div className="text-[12px] text-text-muted">
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
        <input
          className="w-full h-10 rounded-lg border-2 border-border-light bg-bg px-4 text-[14px] text-text outline-none transition-all focus:border-accent focus:shadow-[0_0_0_3px_var(--color-accent-glow)] placeholder:text-text-muted"
          type="password"
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          data-form-type="other"
          placeholder={MODES[mode].placeholder}
          {...register("value")}
        />
        <button
          type="button"
          className="btn-brutal h-10 rounded-lg border-2 border-border bg-surface px-4 text-[13px] font-semibold text-text-secondary hover:text-accent hover:border-accent disabled:opacity-40 shrink-0 shadow-brutal-sm"
          onClick={test}
          disabled={submitDisabled}
          title="Verify the credential with Anthropic"
        >
          {testing ? "..." : "Test"}
        </button>
        <button
          type="submit"
          className="btn-brutal h-10 rounded-lg border-2 border-accent-hover bg-accent px-6 text-[13px] font-semibold text-white disabled:opacity-40 shrink-0 shadow-brutal-accent"
          disabled={submitDisabled}
        >
          {isSubmitting ? "..." : isEdit ? "Replace" : "Save"}
        </button>
      </div>

      {/* Mismatch errors live on the value field; "Required" is suppressed
          until the user actually types so the form doesn't yell on first paint. */}
      {errors.value &&
        value.length > 0 &&
        errors.value.message !== "Required" && (
          <div className="text-[12px] font-medium text-danger">
            {errors.value.message}
          </div>
        )}
      {!errors.value && testResult?.ok && (
        <div className="text-[12px] font-medium text-success flex items-center gap-1.5">
          <Check size={13} /> Credential is valid.
        </div>
      )}
      {!errors.value && testResult && !testResult.ok && (
        <div className="text-[12px] font-medium text-danger">
          {testResult.message}
        </div>
      )}
    </form>
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
    <div className="text-[13px] text-text-secondary">
      Run{" "}
      <span className="inline-flex items-center gap-1.5 align-middle">
        <code className="font-mono font-semibold text-accent">
          claude setup-token
        </code>
        <button
          type="button"
          onClick={copy}
          className="h-5 w-5 rounded inline-flex items-center justify-center text-text-muted hover:text-accent"
          title="Copy command"
        >
          {copied ? (
            <Check size={12} className="text-success" />
          ) : (
            <Copy size={12} />
          )}
        </button>
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
    <div className="flex items-center gap-1 border-b-2 border-border-light">
      {MODE_KEYS.map((m) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            onClick={() => onChange(m)}
            className={`h-10 px-4 text-[13px] font-semibold border-b-2 -mb-[2px] transition-colors ${
              active
                ? "text-accent border-accent"
                : "text-text-muted border-transparent hover:text-text"
            }`}
          >
            {MODES[m].label}
          </button>
        );
      })}
    </div>
  );
}
