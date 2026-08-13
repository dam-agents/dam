import { Badge } from "@/components/ui/badge";
import { CARD_SURFACE } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CUSTOM_IMAGE_DOCS_URL } from "@/constants";
import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

import type { RegistryCredential } from "../registry-credential-section.js";
import { RegistryCredentialSection } from "../registry-credential-section.js";

export interface RegistryControls {
  value: RegistryCredential;
  onChange: (value: RegistryCredential) => void;
  partial: boolean;
  disclosureOverride: boolean | null;
  onDisclosureOverride: (override: boolean) => void;
}

interface Props {
  value: string;
  selected: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  registry?: RegistryControls;
}

export function CustomImageCard({
  value,
  selected,
  onChange,
  onSubmit,
  registry,
}: Props) {
  return (
    <div
      className={cn(
        CARD_SURFACE,
        "px-4 py-4 transition-colors",
        selected ? "border-foreground" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <p className="text-base font-semibold text-foreground">Custom</p>
        <Badge variant="accent">Advanced</Badge>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Bring your own ACP-compatible image{" "}
        <a
          href={CUSTOM_IMAGE_DOCS_URL}
          {...externalLinkProps}
          className="text-sm text-muted-foreground underline underline-offset-2 hover:text-primary"
        >
          Learn more
        </a>
      </p>
      <div className="mt-3">
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
          }}
          placeholder="ghcr.io/org/agent:latest"
          variant="monospace"
        />
      </div>
      {registry && (
        <div className="mt-4 border-t border-border pt-3">
          <RegistryCredentialSection
            value={registry.value}
            onChange={registry.onChange}
            partial={registry.partial}
            disclosureOverride={registry.disclosureOverride}
            onDisclosureOverride={registry.onDisclosureOverride}
          />
        </div>
      )}
    </div>
  );
}
