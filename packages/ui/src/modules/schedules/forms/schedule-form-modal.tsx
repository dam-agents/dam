import { useState } from "react";

import { Modal } from "@/components/modal";

import type { Schedule } from "../../../types.js";
import { OnceScheduleForm } from "./once-schedule-form.js";
import { RecurringScheduleForm } from "./recurring-schedule-form.js";
import {
  type ScheduleDraft,
  type ScheduleKind,
  ScheduleKindField,
} from "./schedule-kind-field.js";

interface Props {
  agentId: string;
  existing?: Schedule;
  onClose: () => void;
}

export function ScheduleFormModal({ agentId, existing, onClose }: Props) {
  const [kind, setKind] = useState<ScheduleKind>(
    existing?.type === "once" ? "once" : "repeat",
  );
  const [draft, setDraft] = useState<ScheduleDraft>({ name: "", task: "" });

  const formProps = existing
    ? { agentId, existing, onClose }
    : {
        agentId,
        draft,
        onDraftChange: setDraft,
        leadingFields: <ScheduleKindField value={kind} onChange={setKind} />,
        onClose,
      };

  return (
    <Modal onClose={onClose}>
      {kind === "once" ? (
        <OnceScheduleForm {...formProps} />
      ) : (
        <RecurringScheduleForm {...formProps} />
      )}
    </Modal>
  );
}
