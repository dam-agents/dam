import { DEFAULT_ENV_PLACEHOLDER, type EnvMapping } from "../types.js";
import {
  allKeyValuesValid,
  type KeyValue,
  KeyValueEditor,
  sanitizeKeyValues,
} from "./key-value-editor.js";

const toKV = (m: EnvMapping): KeyValue => ({
  key: m.envName,
  value: m.placeholder,
});
const fromKV = (kv: KeyValue): EnvMapping => ({
  envName: kv.key,
  placeholder: kv.value || DEFAULT_ENV_PLACEHOLDER,
});

export function EnvMappingsEditor({
  value,
  onChange,
  disabled,
}: {
  value: EnvMapping[];
  onChange: (next: EnvMapping[]) => void;
  disabled?: boolean;
}) {
  return (
    <KeyValueEditor
      value={value.map(toKV)}
      onChange={(kvs) => onChange(kvs.map(fromKV))}
      disabled={disabled}
      newRowValue={DEFAULT_ENV_PLACEHOLDER}
      valuePlaceholder={DEFAULT_ENV_PLACEHOLDER}
      emptyMessage="No env vars declared. The agent will only receive credentials via the Envoy sidecar's on-the-wire injection."
    />
  );
}

export function sanitizeEnvMappings(list: EnvMapping[]): EnvMapping[] {
  return sanitizeKeyValues(list.map(toKV)).map(fromKV);
}

export function allEnvMappingsValid(list: EnvMapping[]): boolean {
  return allKeyValuesValid(list.map(toKV));
}
