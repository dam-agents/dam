import { Callout } from "@/components/ui/callout";

import { getBrand } from "../../../brand.js";

export function GithubStepsCallout({ templateId }: { templateId: string }) {
  if (templateId !== "github" && templateId !== "github-enterprise")
    return null;
  const brand = getBrand().name;
  return (
    <Callout tone="info" size="md" className="text-sm leading-relaxed">
      <p className="font-semibold text-foreground">
        2 steps required for successful connection
      </p>
      <ol className="mt-1.5 list-inside list-decimal text-foreground/90">
        <li>Authorize GitHub account</li>
        <li>Install the {brand} application within your organization</li>
      </ol>
    </Callout>
  );
}
