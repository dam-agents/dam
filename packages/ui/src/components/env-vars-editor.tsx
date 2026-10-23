import type { EnvVar } from "../types.js";
import {
  allKeyValuesValid,
  type KeyValue,
  KeyValueEditor,
  sanitizeKeyValues,
} from "./key-value-editor.js";

const toKV = (v: EnvVar): KeyValue => ({ key: v.name, value: v.value });
const fromKV = (kv: KeyValue): EnvVar => ({ name: kv.key, value: kv.value });

export function EnvVarsEditor({
  value,
  onChange,
  disabled,
}: {
  value: EnvVar[];
  onChange: (next: EnvVar[]) => void;
  disabled?: boolean;
}) {
  return (
    <KeyValueEditor
      value={value.map(toKV)}
      onChange={(kvs) => onChange(kvs.map(fromKV))}
      disabled={disabled}
      valuePlaceholder="value"
      emptyMessage="No env vars set. Add one below."
    />
  );
}

export function sanitizeEnvVars(list: EnvVar[]): EnvVar[] {
  return sanitizeKeyValues(list.map(toKV)).map(fromKV);
}

export function allEnvVarsValid(list: EnvVar[]): boolean {
  return allKeyValuesValid(list.map(toKV));
}
