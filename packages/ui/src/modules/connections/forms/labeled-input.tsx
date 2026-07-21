import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";

export function LabeledInput({
  label,
  testId,
  placeholder,
  type,
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
      <Input
        type={type ?? "text"}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        autoFocus={autoFocus}
      />
    </FormField>
  );
}
