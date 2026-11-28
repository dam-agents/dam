import { WarningAlt } from "@carbon/icons-react";
import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";
import { RadioGroup, RadioGroupCard } from "@/components/ui/radio-group";

import { getBrand } from "../../../brand.js";
import { useSetGrantScope } from "../api/mutations.js";
import {
  ACTS_AS_ITSELF_SCOPE,
  damActsAsItself,
  damActsAsItselfSentence,
  damActsAsYou,
  damActsAsYouSentence,
} from "../lib/dam-connection.js";
import { mutationMessage } from "../lib/mutation-message.js";
import type { GrantAgent } from "./grant-tool-access-dialog.js";

type Choice = "itself" | "owner";

interface Props {
  agent: GrantAgent;
  connection: ConnectionView;
  actsAsItself: boolean;
  onClose: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the dialog where the owner chooses how one Agent reaches the platform: as itself, with an API key of its own that reads only itself and that the security log names, or as the owner, with the owner's key. Save changes this Agent's grant only; choosing the owner again revokes the Agent's key.
export function GrantScopeDialog({
  agent,
  connection,
  actsAsItself,
  onClose,
}: Props) {
  const brand = getBrand().name;
  const saved: Choice = actsAsItself ? "itself" : "owner";
  const [choice, setChoice] = useState<Choice>(saved);
  const save = useSetGrantScope();
  const saveError = mutationMessage(
    save.error,
    "Couldn't change how this agent reaches " + brand + ". Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync({
        agentId: agent.id,
        connectionId: connection.id,
        scope: choice === "itself" ? ACTS_AS_ITSELF_SCOPE : null,
      });
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose} size="md">
      <DialogHeader
        title="Access"
        subtitle={`${connection.name} · for ${agent.name}`}
        onClose={onClose}
        closeDisabled={save.isPending}
        closeTestId="grant-scope-close"
      />
      <DialogBody className="flex flex-col gap-3">
        <RadioGroup
          value={choice}
          onValueChange={(next) =>
            setChoice(next === "owner" ? "owner" : "itself")
          }
          aria-label={`How this agent reaches ${brand}`}
          className="gap-3"
        >
          <RadioGroupCard
            value="itself"
            label={damActsAsItself(brand)}
            description={damActsAsItselfSentence(brand)}
            testId="grant-scope-itself"
          />
          <RadioGroupCard
            value="owner"
            tone="danger"
            label={damActsAsYou(brand)}
            description={damActsAsYouSentence(brand)}
            testId="grant-scope-owner"
          >
            {choice === "owner" && saved === "itself" ? (
              <p className="flex gap-2 text-sm text-danger">
                <WarningAlt size={16} className="mt-0.5 shrink-0" aria-hidden />
                The agent's own key is revoked when you save.
              </p>
            ) : null}
          </RadioGroupCard>
        </RadioGroup>
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={choice === saved}
        onSubmit={() => void submit()}
        testId="grant-scope-submit"
      />
    </Modal>
  );
}
