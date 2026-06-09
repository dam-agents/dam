import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { LabeledInput } from "../../v2/components/labeled-input.js";
import {
  CUSTOM_HARNESS,
  type Harness,
  HARNESSES,
  type HarnessMeta,
} from "../../v2/lib/harnesses.js";

/** The image picker: pre-built harness rows + a Custom Image row that expands
 *  inline to collect a container image URL. */
export function HarnessPicker({
  onPickHarness,
  onPickCustom,
}: {
  onPickHarness: (harness: Harness) => void;
  onPickCustom: (image: string) => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [image, setImage] = useState("");

  return (
    <div className="flex flex-col gap-8">
      <Section label="Pick a pre-built image">
        {HARNESSES.map((harness) => (
          <HarnessRow
            key={harness.id}
            harness={harness}
            onClick={() => onPickHarness(harness.id)}
          />
        ))}
      </Section>

      <Section label="Or bring your own image">
        <div
          className={
            customOpen
              ? "rounded-lg border border-primary bg-primary/[0.03]"
              : ""
          }
        >
          <HarnessRow
            harness={CUSTOM_HARNESS}
            badge="Advanced"
            flat={customOpen}
            onClick={() => setCustomOpen((o) => !o)}
          />
          {customOpen && (
            <div className="flex items-end gap-2 px-4 pb-4">
              <div className="flex-1">
                <LabeledInput
                  label="Image"
                  placeholder="ghcr.io/org/agent:latest"
                  value={image}
                  onChange={setImage}
                  autoFocus
                />
              </div>
              <Button
                onClick={() => onPickCustom(image.trim())}
                disabled={!image.trim()}
              >
                Continue <ArrowRight size={15} />
              </Button>
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function HarnessRow({
  harness,
  badge,
  flat,
  onClick,
}: {
  harness: HarnessMeta;
  badge?: string;
  /** Drop the row's own border/hover when it sits inside an expanded card. */
  flat?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        flat
          ? "group flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left"
          : "group flex w-full flex-col items-start gap-0.5 rounded-lg border border-border px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/[0.03]"
      }
    >
      <span className="flex items-center gap-2 text-[15px] font-bold text-foreground transition-colors group-hover:text-primary">
        {harness.label}
        {badge && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="text-[13px] text-muted-foreground">
        {harness.tagline}
      </span>
    </button>
  );
}
