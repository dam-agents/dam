import { ArrowRight, Close } from "@carbon/icons-react";
import { type ReactNode, useId } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Props {
  model: string;
  subject: string;
  extra?: ReactNode;
  settings?: {
    label: string;
    onConfigure: () => void;
  };
  sessionChoices?: {
    current: string;
    choices: readonly { value: string; name: string }[];
    onChoose: (value: string) => void;
  };
}

export function ModelIndicator({
  model,
  subject,
  extra,
  settings,
  sessionChoices,
}: Props) {
  const titleId = useId();
  const switchable =
    sessionChoices && sessionChoices.choices.length > 0
      ? sessionChoices
      : undefined;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {model}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-labelledby={titleId}
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[300px] flex-col gap-2 overflow-y-auto text-sm"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-bold text-foreground">
            Current model
          </h2>
          <PopoverClose asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Close"
              className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
            >
              <Close size={16} />
            </Button>
          </PopoverClose>
        </div>
        <p className="text-muted-foreground">
          This {subject} is using{" "}
          <span className="text-foreground">{model}</span>
          {guidance(switchable !== undefined, settings?.label)}
        </p>
        {switchable && (
          <ul
            aria-label="Models for this session"
            className="-mx-1 max-h-56 overflow-y-auto"
          >
            {switchable.choices.map((choice) => (
              <li key={choice.value}>
                <PopoverClose asChild>
                  <button
                    type="button"
                    aria-current={
                      choice.value === switchable.current ? "true" : undefined
                    }
                    onClick={() => switchable.onChoose(choice.value)}
                    className="w-full truncate rounded px-1 py-1 text-left text-muted-foreground hover:bg-muted hover:text-foreground aria-[current]:font-medium aria-[current]:text-foreground"
                  >
                    {choice.name}
                  </button>
                </PopoverClose>
              </li>
            ))}
          </ul>
        )}
        {extra}
        {settings && (
          <PopoverClose asChild>
            <button
              type="button"
              onClick={settings.onConfigure}
              className="inline-flex items-center gap-1.5 self-start font-medium text-accent hover:underline"
            >
              Configure model <ArrowRight size={16} />
            </button>
          </PopoverClose>
        )}
      </PopoverContent>
    </Popover>
  );
}

function guidance(canSwitch: boolean, settingsLabel: string | undefined) {
  if (canSwitch && settingsLabel) {
    return `. Switch it below, or change the default for new sessions in ${settingsLabel}.`;
  }
  if (canSwitch) return ". Switch it below.";
  if (settingsLabel) return `. Change the model in ${settingsLabel}.`;
  return ".";
}
