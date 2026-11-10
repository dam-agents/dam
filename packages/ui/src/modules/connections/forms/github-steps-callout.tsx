import { Information } from "@carbon/icons-react";

import { cn } from "@/lib/utils";

import { getBrand } from "../../../brand.js";
import { INSTALL_REACH } from "../components/github-app-install-hint.js";
import { isGithubSignInTemplate } from "../lib/github-installations.js";

export function GithubStepsCallout({
  templateId,
  className,
}: {
  templateId: string;
  className?: string;
}) {
  if (!isGithubSignInTemplate(templateId)) return null;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs text-muted-foreground",
        className,
      )}
      data-testid="github-steps-hint"
    >
      <Information size={12} aria-hidden className="mt-0.5 shrink-0" />
      <span>
        Sign in with GitHub, then install the {getBrand().name} app{" "}
        {INSTALL_REACH}.
      </span>
    </p>
  );
}
