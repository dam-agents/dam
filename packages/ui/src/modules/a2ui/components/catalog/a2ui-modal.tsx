import { type MouseEvent, useState } from "react";

import { DialogBody, DialogHeader, Modal } from "@/components/modal";

import type { ModalComponent } from "../../lib/schema.js";
import { A2uiNode } from "../a2ui-node.js";

interface Props {
  component: ModalComponent;
  depth: number;
}

export function A2uiModal({ component, depth }: Props) {
  const [open, setOpen] = useState(false);
  function handleTriggerClick(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    setOpen(true);
  }
  return (
    <>
      <div className="contents" onClickCapture={handleTriggerClick}>
        <A2uiNode id={component.trigger} depth={depth + 1} />
      </div>
      {open && (
        <Modal onClose={() => setOpen(false)}>
          <DialogHeader onClose={() => setOpen(false)} divided={false} />
          <DialogBody className="pt-0 md:pt-0">
            <A2uiNode id={component.content} depth={depth + 1} />
          </DialogBody>
        </Modal>
      )}
    </>
  );
}
