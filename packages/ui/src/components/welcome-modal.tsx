import { Book, Chemistry, Close, ContainerSoftware } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { DialogBody, DialogHeader, Modal } from "./modal.js";

interface WelcomeModalProps {
  onSelect: (choice: "wiki" | "sandbox" | "experiment") => void;
  onClose: () => void;
}

export function WelcomeModal({ onSelect, onClose }: WelcomeModalProps) {
  return (
    <Modal>
      <DialogHeader>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold text-foreground">
              Accelerate research with DAM
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              Run agents in isolated cloud environments with credentials and
              tools securely injected. Create knowledge bases, run experiments
              to compare agent variants, and trigger agents from Slack or on a
              schedule.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Close size={16} />
          </button>
        </div>
      </DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-3">
          <WelcomeCard
            icon={<ContainerSoftware size={16} />}
            title="Create a coding agent"
            description="Work with your preferred coding agent, credentials, and tools in an isolated environment."
            onClick={() => onSelect("sandbox")}
          />
          <WelcomeCard
            icon={<Chemistry size={16} />}
            title="Begin an experiment"
            description="Run one goal across many variants at once and compare results."
            onClick={() => onSelect("experiment")}
          />
          <WelcomeCard
            icon={<Book size={16} />}
            title="Start a knowledge base"
            description="Organize and converse with data sourced from repos, documents, and more (LLM wiki)."
            onClick={() => onSelect("wiki")}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Skip
          </Button>
        </div>
      </DialogBody>
    </Modal>
  );
}

function WelcomeCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-4 text-left transition-all hover:shadow-lg flex-1 w-full focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <div className="flex items-start gap-4">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6] bg-background/80">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-foreground">{title}</p>
          <p className="mt-0.5 text-[14px] leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </button>
  );
}
