import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function LabeledInput({
  label,
  testId,
  placeholder,
  type,
  multiline,
  value,
  onChange,
  onBlur,
  help,
  error,
  autoFocus,
  inset,
}: {
  label: string;
  testId?: string;
  placeholder?: string;
  type?: "text" | "password";
  // Renders a monospace textarea instead of a single-line input (e.g. a PEM key).
  multiline?: boolean;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  help?: string;
  error?: string;
  autoFocus?: boolean;
  inset?: boolean;
}) {
  return (
    <FormField
      label={label}
      hint={help}
      error={error}
      disableInset={!inset}
      labelInset={inset}
    >
      {multiline ? (
        <Textarea
          variant={error ? "invalid" : "monospace"}
          className="font-mono"
          rows={8}
          data-testid={testId}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
        />
      ) : (
        <Input
          type={type ?? "text"}
          variant={error ? "invalid" : undefined}
          data-testid={testId}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoFocus={autoFocus}
        />
      )}
    </FormField>
  );
}
