import { Close } from "@carbon/icons-react";

import { Button } from "@/components/ui/button";
import {
  StartingOptions,
  type StartingOption,
} from "@/mock/variant-card";

import { DialogBody, DialogFooter, DialogHeader, Modal } from "./modal.js";

interface StartingPointModalProps {
  title: string;
  description?: string;
  options: StartingOption[];
  onSelect: (option: StartingOption) => void;
  onClose: () => void;
  fallback?: StartingOption;
  onFallback?: () => void;
  columns?: 2 | 3;
}

export function StartingPointModal({
  title,
  description,
  options,
  onSelect,
  onClose,
  fallback,
  onFallback,
  columns = 3,
}: StartingPointModalProps) {
  return (
    <Modal widthClass={columns === 2 ? "w-[560px]" : "w-[720px]"}>
      <DialogHeader>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold text-foreground">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Close size={18} />
          </button>
        </div>
      </DialogHeader>

      <DialogBody>
        <StartingOptions
          options={options}
          onSelect={onSelect}
          fallback={fallback}
          onFallback={onFallback}
          columns={columns}
        />
      </DialogBody>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </DialogFooter>
    </Modal>
  );
}
