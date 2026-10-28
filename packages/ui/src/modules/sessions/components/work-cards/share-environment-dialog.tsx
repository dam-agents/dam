import {
  Add,
  Checkmark,
  Copy,
  Locked,
  Share,
  TrashCan,
} from "@carbon/icons-react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useCopy } from "@/hooks/use-copy";
import { emitToast } from "@/lib/toast";

interface Props {
  name: string;
  accessLabel?: string;
  onClose: () => void;
}

type Visibility = "private" | "restricted";

export function ShareEnvironmentDialog({ name, accessLabel, onClose }: Props) {
  const initial: Visibility =
    accessLabel &&
    accessLabel.toLowerCase() !== "private" &&
    accessLabel.toLowerCase() !== "only you"
      ? "restricted"
      : "private";
  const [visibility, setVisibility] = useState<Visibility>(initial);
  const [email, setEmail] = useState("");
  const [people, setPeople] = useState<string[]>(
    initial === "restricted" ? ["samantha.dempsey@example.com"] : [],
  );
  const { copy, copied } = useCopy();

  const shareUrl = `https://share.example.com/env/${name}`;

  const addPerson = () => {
    const trimmed = email.trim();
    if (!trimmed || people.includes(trimmed)) return;
    setPeople((prev) => [...prev, trimmed]);
    setEmail("");
    if (visibility === "private") setVisibility("restricted");
  };

  const removePerson = (target: string) => {
    setPeople((prev) => prev.filter((p) => p !== target));
  };

  const save = () => {
    emitToast({
      kind: "success",
      message:
        visibility === "private"
          ? `${name} is now private.`
          : `${name} shared with ${people.length} ${people.length === 1 ? "person" : "people"}.`,
    });
    onClose();
  };

  return (
    <Modal>
      <DialogHeader title={`Share "${name}"`} onClose={onClose} />
      <DialogBody>
        <div className="flex flex-col gap-5">
          <RadioGroupPrimitive.Root
            value={visibility}
            onValueChange={(v) => setVisibility(v as Visibility)}
            className="flex flex-col gap-4"
          >
            <RadioGroupPrimitive.Item
              value="private"
              className="flex w-full items-start gap-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary">
                <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  Private <Locked size={14} />
                </span>
                <span className="text-sm text-muted-foreground">Only you</span>
              </span>
            </RadioGroupPrimitive.Item>

            <RadioGroupPrimitive.Item
              value="restricted"
              className="flex w-full items-start gap-2.5 text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-primary">
                <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                  Restricted <Share size={14} />
                </span>
                <span className="text-sm text-muted-foreground">
                  Only invited people
                </span>
              </span>
            </RadioGroupPrimitive.Item>
          </RadioGroupPrimitive.Root>

          <div className="flex items-center gap-2">
            <Input
              placeholder="name@company.com"
              size="sm"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPerson();
                }
              }}
            />
            <Button variant="outline" size="sm" onClick={addPerson}>
              <Add size={14} />
              Add
            </Button>
          </div>

          {people.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                {people.length} / 50 people on the list
              </span>
              {people.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between py-1.5 text-sm text-foreground"
                >
                  {p}
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${p}`}
                    onClick={() => removePerson(p)}
                  >
                    <TrashCan size={14} className="text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={shareUrl}
              size="sm"
              variant="monospace"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Copy link"
              tooltip="Copy link"
              onClick={() => void copy(shareUrl)}
            >
              {copied ? (
                <Checkmark size={14} className="text-success" />
              ) : (
                <Copy size={14} />
              )}
            </Button>
          </div>
        </div>
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelLabel="Close"
        label="Save"
        pendingLabel="Saving…"
        onSubmit={save}
      />
    </Modal>
  );
}
