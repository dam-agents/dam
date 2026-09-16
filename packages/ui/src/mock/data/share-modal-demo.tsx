import { Add, Checkmark, Close, Copy } from "@carbon/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useCopy } from "@/hooks/use-copy";

type AccessLevel = "private" | "public" | "restricted";

interface Invitee {
  name: string;
  email: string;
}

const SEED_INVITEES: Invitee[] = [
  { name: "Ana Fucs", email: "ana.fucs@ibm.com" },
  { name: "Samantha Dempsey", email: "samantha.dempsey@ibm.com" },
  { name: "Sarah Miller", email: "millers@ibm.com" },
];

const DEMO_SHARE_URL = "https://dam.example.com/a/6TEAyF3_0a0ZBw";

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? email;
  return local
    .split(".")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export function ShareModalDemo() {
  const [access, setAccess] = useState<AccessLevel>("restricted");
  const [emailInput, setEmailInput] = useState("");
  const [invitees, setInvitees] = useState<Invitee[]>(SEED_INVITEES);
  const { copy, copied } = useCopy();

  const addInvitee = () => {
    const email = emailInput.trim().toLowerCase();
    if (!email || !email.includes("@")) return;
    if (invitees.some((i) => i.email === email)) return;
    setInvitees((prev) => [...prev, { name: nameFromEmail(email), email }]);
    setEmailInput("");
  };

  const removeInvitee = (email: string) => {
    setInvitees((prev) => prev.filter((i) => i.email !== email));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addInvitee();
    }
  };

  const showLink = access === "public" || access === "restricted";

  return (
    <div className="w-[560px] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border px-7 pb-4 pt-7">
        <h2 className="text-base font-semibold text-foreground">
          Share &ldquo;Weekly Report&rdquo;
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close"
          className="-mr-3 -mt-3 shrink-0 text-muted-foreground"
        >
          <Close size={16} />
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-5 px-7 py-5">
        <RadioGroup
          value={access}
          onValueChange={(v) => setAccess(v as AccessLevel)}
        >
          <RadioGroupItem
            value="private"
            label="Private"
            description="Only you"
          />
          <RadioGroupItem
            value="public"
            label="Public"
            description="Anyone with the link"
          />
          <RadioGroupItem
            value="restricted"
            label="Restricted"
            description="Only invited people"
          />
        </RadioGroup>

        {/* Share link — visible for Public and Restricted */}
        {showLink && (
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={DEMO_SHARE_URL}
              variant="monospace"
              size="sm"
              onFocus={(e) => e.currentTarget.select()}
              className="flex-1"
            />
            <Button
              variant="outline"
              size="icon-sm"
              aria-label="Copy link"
              onClick={() => void copy(DEMO_SHARE_URL)}
            >
              {copied ? (
                <Checkmark size={14} className="text-success" />
              ) : (
                <Copy size={14} />
              )}
            </Button>
          </div>
        )}

        {/* Restricted: invite input + list */}
        {access === "restricted" && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Input
                placeholder="name@company.com"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                onKeyDown={onKeyDown}
                className="flex-1"
              />
              <Button onClick={addInvitee} disabled={!emailInput.trim()}>
                Invite
                <Add size={16} />
              </Button>
            </div>

            {invitees.length > 0 && (
              <div className="flex flex-col gap-1">
                <p className="text-sm text-muted-foreground">
                  Shared with ({invitees.length}{" "}
                  {invitees.length === 1 ? "person" : "people"})
                </p>
                <div className="flex max-h-[200px] flex-col gap-0.5 overflow-y-auto">
                  {invitees.map((invitee) => (
                    <div
                      key={invitee.email}
                      className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                        {invitee.name.charAt(0)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {invitee.name}
                        </p>
                        <p className="truncate text-sm text-muted-foreground">
                          {invitee.email}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove ${invitee.name}`}
                        onClick={() => removeInvitee(invitee.email)}
                        className="shrink-0 text-muted-foreground hover:text-foreground"
                      >
                        <Close size={16} />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 px-7 py-4">
        <Button variant="outline">Close</Button>
        <Button>Save</Button>
      </div>
    </div>
  );
}
