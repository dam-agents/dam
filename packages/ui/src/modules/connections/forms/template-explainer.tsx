import { getBrand } from "../../../brand.js";
import { DisclosureBox } from "./disclosure-box.js";

/** Per-template "how does this work?" block; null for templates without one. */
export function TemplateExplainer({ templateId }: { templateId: string }) {
  if (templateId === "github" || templateId === "github-enterprise")
    return <GithubAuthExplainer />;
  return null;
}

function GithubAuthExplainer() {
  const brand = getBrand().name;
  return (
    <DisclosureBox
      title="How does GitHub authorization work?"
      defaultOpen
      bodyClassName="bg-muted/40"
    >
      <div className="flex flex-col gap-3 text-[13px] leading-relaxed text-muted-foreground">
        <p>
          Signing in confirms who you are — it does <strong>not</strong>, by
          itself, grant access to your repositories. Installing the app is what
          grants that access.
        </p>
        <p>
          <strong className="text-foreground/80">1. Sign in with GitHub</strong>{" "}
          — confirms your identity and connects your account. On its own, it
          does <strong>not</strong> grant access to your repositories.
        </p>
        <p>
          <strong className="text-foreground/80">
            2. Install the {brand} app on an organization
          </strong>{" "}
          — you choose which of that org's repositories {brand} can read/write.
          This is the step that actually grants access, and it's done{" "}
          <strong>once per organization</strong>.
        </p>
        <p>
          If you aren't an organization owner, an owner must approve or complete
          the install. Reach out to them first so they're expecting the request.
        </p>
      </div>
    </DisclosureBox>
  );
}
