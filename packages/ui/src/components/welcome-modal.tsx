import { Book, Chemistry, ContainerSoftware, Close } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

import { DialogBody, DialogHeader, Modal } from "./modal.js";

interface WelcomeModalProps {
  onSelect: (choice: "wiki" | "sandbox" | "experiment") => void;
  onClose: () => void;
}

export function WelcomeModal({ onSelect, onClose }: WelcomeModalProps) {
  return (
    <Modal widthClass="w-[720px]">
      <DialogHeader>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[20px] font-semibold text-foreground">
              Welcome to DAM
            </h2>
            <p className="mt-1.5 text-[14px] leading-relaxed text-muted-foreground">
              Dam is a platform for running AI agents in isolated environments
              with credential injection, network isolation, and scheduled
              execution. Choose how you'd like to get started.
            </p>
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <WelcomeCard
            icon={<Book size={24} />}
            title="Start an LLM Wiki"
            description="Create a knowledge base powered by an LLM that indexes and answers questions about your docs."
            onClick={() => onSelect("wiki")}
          />
          <WelcomeCard
            icon={<ContainerSoftware size={24} />}
            title="Start a Coding Sandbox"
            description="Spin up an isolated environment with your preferred AI coding agent, credentials, and tools."
            onClick={() => onSelect("sandbox")}
          />
          <WelcomeCard
            icon={<Chemistry size={24} />}
            title="Start an Experiment"
            description="Run prompt tuning, evaluations, or research workflows with configurable frameworks."
            onClick={() => onSelect("experiment")}
          />
        </div>

        <div className="mt-4 flex justify-center">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Skip for now
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
    <div className="relative rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card p-4 text-left transition-all hover:shadow-lg">
      <button
        type="button"
        onClick={onClick}
        aria-label={title}
        className="absolute inset-0 rounded-2xl focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      <div className="pointer-events-none relative flex flex-col gap-3">
        <div className="flex size-[38px] shrink-0 items-center justify-center rounded-lg border border-[#dde1e6] bg-background/80">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
    </div>
  );
}
