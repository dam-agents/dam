import { Input } from "@/components/ui/input";

export function LabeledInput({
  label,
  hint,
  type = "text",
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  hint?: string;
  type?: "text" | "password";
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const secret = type === "password";
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-foreground/80 block mb-1.5">
        {label}
      </span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete={secret ? "off" : undefined}
        data-1p-ignore={secret ? true : undefined}
        data-lpignore={secret ? "true" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && (
        <span className="text-[11px] text-muted-foreground block mt-1">
          {hint}
        </span>
      )}
    </label>
  );
}
