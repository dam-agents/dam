import { FormField } from "@/components/form-field";
import { Input } from "@/components/ui/input";

export function LabeledInput({
  label,
  testId,
  placeholder,
  type,
  value,
  onChange,
  help,
}: {
  label: string;
  testId?: string;
  placeholder?: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  help?: string;
}) {
  return (
    <FormField label={label} hint={help} disableInset>
      <Input
        type={type ?? "text"}
        data-testid={testId}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </FormField>
  );
}
