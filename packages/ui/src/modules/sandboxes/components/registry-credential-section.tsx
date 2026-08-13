import { DisclosureToggle } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { labelVariants } from "@/components/ui/label";
import { cn } from "@/lib/utils";

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

export function registryFilledCount(value: RegistryCredential): number {
  return [value.server, value.username, value.password].filter(
    (field) => field.trim().length > 0,
  ).length;
}

interface Props {
  value: RegistryCredential;
  onChange: (value: RegistryCredential) => void;
  partial: boolean;
  disclosureOverride: boolean | null;
  onDisclosureOverride: (override: boolean) => void;
}

export function RegistryCredentialSection({
  value,
  onChange,
  partial,
  disclosureOverride,
  onDisclosureOverride,
}: Props) {
  const expanded =
    partial || (disclosureOverride ?? registryFilledCount(value) > 0);
  const set = (key: keyof RegistryCredential, next: string) => {
    onDisclosureOverride(true);
    onChange({ ...value, [key]: next });
  };

  return (
    <div>
      <DisclosureToggle
        open={expanded}
        onToggle={() => onDisclosureOverride(!expanded)}
        chevronSize={12}
        className={cn(labelVariants(), "gap-1.5 hover:text-foreground")}
      >
        Private registry
      </DisclosureToggle>
      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            Credentials to pull this image from a private registry. Stored with
            the sandbox and used only by the cluster to pull the image — never
            exposed to the agent.
          </p>
          <FormField label="Server" labelInset>
            <Input
              placeholder="ghcr.io"
              value={value.server}
              onChange={(e) => set("server", e.target.value)}
            />
          </FormField>
          <FormField label="Username" labelInset>
            <Input
              placeholder="octocat"
              value={value.username}
              onChange={(e) => set("username", e.target.value)}
            />
          </FormField>
          <FormField label="Password" labelInset>
            <Input
              type="password"
              placeholder="PAT, robot account, or access token"
              value={value.password}
              onChange={(e) => set("password", e.target.value)}
            />
          </FormField>
          {partial && (
            <p className="text-xs text-destructive">
              Enter server, username, and password — or clear all three to skip.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
