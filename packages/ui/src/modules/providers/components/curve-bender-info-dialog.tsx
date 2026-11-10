import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { externalLinkProps } from "@/lib/external-link";

import { getBrand } from "../../../brand.js";

export const CURVE_BENDER_DOCS_URL =
  "https://cb-docs-curvebender.apps.fmaas-backend.fmaas.res.ibm.com/ai-platform-incubation/cb_docs/";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the deployment's CurveBender is a provider the
 * user holds no key for and cannot change, so its row opens this instead of a
 * form: that every user of this deployment runs on it, and where its docs are.
 * Nothing here is editable and nothing is fetched.
 */
export function CurveBenderInfoDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} size="sm">
      <DialogHeader title="CurveBender" onClose={onClose} />
      <DialogBody>
        <p className="text-sm leading-relaxed text-muted-foreground">
          All {getBrand().name} users are set up with CurveBender, IBM-hosted
          open-source models.{" "}
          <a
            href={CURVE_BENDER_DOCS_URL}
            {...externalLinkProps}
            className="font-medium text-accent underline underline-offset-2 hover:text-primary"
          >
            Learn more
          </a>
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </Modal>
  );
}
