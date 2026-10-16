import { CheckmarkFilled } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

import type { FormPart } from "../types.js";

interface ChatFormCardProps {
  part: FormPart;
}

export function ChatFormCard({ part }: ChatFormCardProps) {
  const [localAnswered, setLocalAnswered] = useState(false);
  const answered = part.answered || localAnswered;

  if (answered && part.summary) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-4 py-2.5">
        <CheckmarkFilled size={16} className="shrink-0 text-accent" />
        <span className="text-[14px] text-foreground">{part.summary}</span>
      </div>
    );
  }

  if (answered) {
    return null;
  }

  return (
    <div className="w-full rounded-2xl border border-border bg-gradient-to-br from-muted/60 to-card overflow-hidden">
      <div className="px-5 py-4 space-y-3">
        <h3 className="text-[15px] font-semibold tracking-tight text-foreground">
          {part.label}
        </h3>
        <FormBody part={part} onAnswer={() => setLocalAnswered(true)} />
      </div>
    </div>
  );
}

function FormBody({
  part,
  onAnswer,
}: {
  part: FormPart;
  onAnswer: () => void;
}) {
  switch (part.formKind) {
    case "connect":
      return <ConnectForm label={part.label} onAnswer={onAnswer} />;
    case "select":
      return <SelectForm options={part.options ?? []} onAnswer={onAnswer} />;
    case "toggle-list":
      return (
        <ToggleListForm options={part.options ?? []} onAnswer={onAnswer} />
      );
    case "input":
      return <InputForm onAnswer={onAnswer} />;
    case "confirm":
      return <ConfirmForm onAnswer={onAnswer} />;
    default:
      return null;
  }
}

function ConnectForm({
  label,
  onAnswer,
}: {
  label: string;
  onAnswer: () => void;
}) {
  return (
    <Button size="sm" onClick={onAnswer}>
      Connect {label.replace(/^Connect\s+/i, "")}
    </Button>
  );
}

function SelectForm({
  options,
  onAnswer,
}: {
  options: Array<{ id: string; label: string }>;
  onAnswer: () => void;
}) {
  const [selected, setSelected] = useState<string>("");
  return (
    <div className="space-y-3">
      <RadioGroup value={selected} onValueChange={setSelected}>
        {options.map((opt) => (
          <RadioGroupItem key={opt.id} value={opt.id} label={opt.label} />
        ))}
      </RadioGroup>
      <Button size="sm" disabled={!selected} onClick={onAnswer}>
        Confirm
      </Button>
    </div>
  );
}

function ToggleListForm({
  options,
  onAnswer,
}: {
  options: Array<{ id: string; label: string; defaultOn?: boolean }>;
  onAnswer: () => void;
}) {
  const [toggles, setToggles] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(options.map((o) => [o.id, o.defaultOn ?? false])),
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {options.map((opt) => (
          <div key={opt.id} className="flex items-center justify-between">
            <span
              className={cn(
                "text-[14px]",
                toggles[opt.id] ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {opt.label}
            </span>
            <Switch
              label={opt.label}
              checked={toggles[opt.id] ?? false}
              onCheckedChange={(checked) =>
                setToggles((prev) => ({ ...prev, [opt.id]: checked }))
              }
            />
          </div>
        ))}
      </div>
      <Button size="sm" onClick={onAnswer}>
        Confirm
      </Button>
    </div>
  );
}

function InputForm({ onAnswer }: { onAnswer: () => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex gap-2">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type your answer..."
        className="text-[14px]"
      />
      <Button size="sm" disabled={!value.trim()} onClick={onAnswer}>
        Send
      </Button>
    </div>
  );
}

function ConfirmForm({ onAnswer }: { onAnswer: () => void }) {
  return (
    <div className="flex gap-2">
      <Button size="sm" onClick={onAnswer}>
        Yes
      </Button>
      <Button size="sm" variant="outline" onClick={onAnswer}>
        No
      </Button>
    </div>
  );
}
