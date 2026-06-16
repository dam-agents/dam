import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { Input } from "@/components/ui/input";

import { FormField } from "../../../components/form-field.js";

export interface RegistryCredential {
  server: string;
  username: string;
  password: string;
}

export const EMPTY_REGISTRY_CREDENTIAL: RegistryCredential = {
  server: "",
  username: "",
  password: "",
};

/** server/username/password are all-or-nothing — partial entry is invalid. */
export function registryFilledCount(value: RegistryCredential): number {
  return [value.server, value.username, value.password].filter(
    (field) => field.trim().length > 0,
  ).length;
}

interface Props {
  value: RegistryCredential;
  onChange: (value: RegistryCredential) => void;
  partial: boolean;
}

export function RegistryCredentialSection({ value, onChange, partial }: Props) {
  const [open, setOpen] = useState(false);
  const expanded = open || partial;
  const Icon = expanded ? ChevronDown : ChevronRight;
  const set = (key: keyof RegistryCredential, next: string) =>
    onChange({ ...value, [key]: next });

  return (
    <section className="mb-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted-foreground hover:text-foreground"
      >
        <Icon size={12} />
        Private registry
      </button>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[12px] text-muted-foreground">
            Credentials to pull this image from a private registry. Stored with
            the sandbox and used only by the cluster to pull the image — never
            exposed to the agent.
          </p>
          <FormField label="Server">
            <Input
              placeholder="ghcr.io"
              value={value.server}
              onChange={(e) => set("server", e.target.value)}
            />
          </FormField>
          <FormField label="Username">
            <Input
              value={value.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </FormField>
          <FormField label="Password">
            <Input
              type="password"
              placeholder="PAT, robot account, or access token"
              value={value.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </FormField>
          {partial && (
            <p className="text-[12px] text-destructive">
              Enter server, username, and password — or clear all three to skip.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
