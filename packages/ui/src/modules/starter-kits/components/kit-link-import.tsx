import { Link } from "@carbon/icons-react";
import { LINKED_KIT_CATALOG } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useStore } from "../../../store.js";
import { kitLinkSlug } from "../lib/kit-link.js";

export function KitLinkButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      data-testid="kit-link-import"
    >
      <Link size={16} aria-hidden /> Import from link
    </Button>
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The dialog "Import from link" opens. It takes a
 * link to a kit's repository — the way a teammate shares a kit nobody added to
 * a catalog — and opens that kit's page, where the user sees what it sets up
 * before creating anything.
 */
export function KitLinkDialog({
  onClose,
  onOpenKit,
}: {
  onClose: () => void;
  onOpenKit: () => void;
}) {
  const navigateToStarterKit = useStore((s) => s.navigateToStarterKit);
  const [link, setLink] = useState("");
  const [touched, setTouched] = useState(false);
  const slug = kitLinkSlug(link);
  const invalid = touched && link.trim() !== "" && slug === null;

  return (
    <Modal widthClass="w-[520px]" onClose={onClose}>
      <form
        className="contents"
        onSubmit={(event) => {
          event.preventDefault();
          setTouched(true);
          if (!slug) return;
          onOpenKit();
          navigateToStarterKit(LINKED_KIT_CATALOG, slug);
        }}
        data-testid="kit-link-form"
      >
        <DialogHeader
          title="Import a starter kit"
          onClose={onClose}
          divided={false}
          className="pb-0 md:pb-0"
        />
        <DialogBody className="pt-2.5 md:pt-2.5">
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://github.com/owner/repository"
            aria-label="Link to the kit's repository"
            variant={invalid ? "invalid" : "standard"}
            aria-invalid={invalid}
            aria-describedby={invalid ? "kit-link-error" : "kit-link-hint"}
            autoComplete="off"
            spellCheck={false}
          />
          {invalid ? (
            <p
              id="kit-link-error"
              role="alert"
              className="mt-2 text-sm text-danger"
            >
              Paste a repository link such as
              https://github.com/owner/repository, not a link to a branch or
              folder.
            </p>
          ) : (
            <p
              id="kit-link-hint"
              className="mt-2 text-[13px] text-muted-foreground"
            >
              A public GitHub repository with a kit.yaml.
            </p>
          )}
        </DialogBody>
        <DialogActions
          onCancel={onClose}
          label="Open kit"
          pendingLabel="Open kit"
          disabled={link.trim() === ""}
          divided={false}
        />
      </form>
    </Modal>
  );
}
