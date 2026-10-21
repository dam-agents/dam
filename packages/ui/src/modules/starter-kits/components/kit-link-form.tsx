import { Link } from "@carbon/icons-react";
import { LINKED_KIT_CATALOG } from "api-server-api";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useStore } from "../../../store.js";
import { kitLinkSlug } from "../lib/kit-link.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The field under the catalog that takes a link to
 * a kit's repository — the way a teammate shares a kit nobody added to a
 * catalog — and opens that kit's page, where the user sees what it sets up
 * before creating anything.
 */
export function KitLinkForm({ onOpenKit }: { onOpenKit?: () => void }) {
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const [link, setLink] = useState("");
  const [touched, setTouched] = useState(false);
  const slug = kitLinkSlug(link);
  const invalid = touched && link.trim() !== "" && slug === null;

  const open = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!slug) return;
    onOpenKit?.();
    navigateToStarterKit(LINKED_KIT_CATALOG, slug);
  };

  return (
    <form
      onSubmit={open}
      className="mt-8 rounded-lg border border-dashed border-border p-4"
      data-testid="kit-link-form"
    >
      <label
        htmlFor="kit-link"
        className="flex items-center gap-2 text-sm font-medium text-foreground"
      >
        <Link size={16} aria-hidden /> Use a kit from a link
      </label>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste the link to a public GitHub repository with a kit.yaml, for
        example one a teammate shared. You see what it sets up before the agent
        is created.
      </p>
      <div className="mt-3 flex gap-2">
        <Input
          id="kit-link"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder="https://github.com/owner/repository"
          variant={invalid ? "invalid" : "standard"}
          aria-invalid={invalid}
          aria-describedby={invalid ? "kit-link-error" : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <Button type="submit" variant="outline" disabled={link.trim() === ""}>
          Open kit
        </Button>
      </div>
      {invalid && (
        <p
          id="kit-link-error"
          role="alert"
          className="mt-2 text-sm text-danger"
        >
          Paste a repository link such as https://github.com/owner/repository,
          not a link to a branch or folder.
        </p>
      )}
    </form>
  );
}
