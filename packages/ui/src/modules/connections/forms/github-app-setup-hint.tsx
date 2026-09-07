import { Launch } from "@carbon/icons-react";

import { Callout } from "@/components/ui/callout";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";

export function GithubAppSetupHint({ templateId }: { templateId: string }) {
  if (templateId !== "github-app" && templateId !== "github-enterprise-app")
    return null;
  const createUrl =
    templateId === "github-app"
      ? "https://github.com/settings/apps/new"
      : undefined;
  return (
    <Callout tone="muted" className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        Create a GitHub App under Settings → Developer settings → GitHub Apps,
        grant it the repository permissions your agents need, and install it on
        your organization.
        {createUrl && (
          <>
            {" "}
            <a
              href={createUrl}
              {...externalLinkProps}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              Create an app <Launch size={11} />
            </a>
          </>
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {getBrand().name} only mints tokens from the app's private key — leave
        Callback URL empty and uncheck the webhook's Active box.
      </p>
    </Callout>
  );
}
