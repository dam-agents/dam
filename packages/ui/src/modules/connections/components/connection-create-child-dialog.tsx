import type { ConnectionView } from "api-server-api";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";

import { createChildHeading } from "../lib/connection-hierarchy.js";
import { ConnectionCreateChildForm } from "./connection-create-child-form.js";

interface Props {
  parent: ConnectionView;
  onCreated: (id: string) => void;
  onClose: () => void;
  onLater?: () => void;
}

export function ConnectionCreateChildDialog({
  parent,
  onCreated,
  onClose,
  onLater,
}: Props) {
  const heading = createChildHeading(parent);
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title={heading.title}
        subtitle={heading.subtitle}
        onClose={onClose}
        closeTestId="create-child-close"
      />
      <ConnectionCreateChildForm
        parent={parent}
        onCreated={onCreated}
        onCancel={onClose}
        onLater={onLater}
        layout={(fields, footer) => (
          <>
            <DialogBody>{fields}</DialogBody>
            <DialogFooter>{footer}</DialogFooter>
          </>
        )}
      />
    </Modal>
  );
}
