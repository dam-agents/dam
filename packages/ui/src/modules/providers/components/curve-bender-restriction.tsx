import { externalLinkProps } from "@/lib/external-link";
import { cn } from "@/lib/utils";

export const CURVE_BENDER_RESTRICTIONS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/getting-started/model-usage-guidance/";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the statement that CurveBender's models are
 * approved for restricted use cases only, with the phrase linking to the page
 * that says which. Legal requires it wherever a person is told about
 * CurveBender, so the chat notice and the Providers explainer share this one
 * line.
 */
export function CurveBenderRestriction({ className }: { className?: string }) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)}>
      These models are currently only approved for{" "}
      <a
        href={CURVE_BENDER_RESTRICTIONS_URL}
        {...externalLinkProps}
        className="underline underline-offset-2 hover:text-foreground"
      >
        restricted use cases
      </a>
      .
    </p>
  );
}
