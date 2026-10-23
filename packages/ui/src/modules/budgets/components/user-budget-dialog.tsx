import {
  budgetCpuSchema,
  budgetSizeSchema,
  type UserBudgetDefaults,
  type UserBudgetEntry,
  type UserBudgetSetInput,
  userBudgetUserSchema,
} from "api-server-api";
import { useState } from "react";

import { OperatorOverrideDialog } from "../../operator/components/operator-override-dialog.js";
import { useSetUserBudget } from "../api/mutations.js";
import {
  BUDGET_APPLIES_NEXT_START,
  BUDGET_REMOVED_MEANWHILE,
  BUDGET_SAVE_FAILED,
  SET_BUDGET,
} from "../lib/user-budget-copy.js";

type Field = "cpu" | "memory" | "storage";

const FIELDS: Record<
  Field,
  {
    label: string;
    hint: string;
    schema: typeof budgetCpuSchema;
    invalid: string;
  }
> = {
  cpu: {
    label: "CPU",
    hint: "Cores, like 8, 2.5 or 500m.",
    schema: budgetCpuSchema,
    invalid: "Enter more than 0 cores, like 8, 2.5 or 500m.",
  },
  memory: {
    label: "Memory",
    hint: "Like 16Gi or 512Mi.",
    schema: budgetSizeSchema,
    invalid: "Enter a size above 0 with a unit, like 16Gi or 512Mi.",
  },
  storage: {
    label: "Storage",
    hint: "For VM agents. A user's storage never shrinks: a lower value only stops its growth.",
    schema: budgetSizeSchema,
    invalid: "Enter a size above 0 with a unit, like 500Gi.",
  },
};

interface Props {
  entry: UserBudgetEntry | null;
  defaults: UserBudgetDefaults;
  onClose: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: sets a new user's compute budget by email, or changes an existing one. Each field shows the default as its placeholder, and an empty field uses the default. A change sends only the fields that differ from the budget as it was opened, so it never undoes another operator's change to another field, and a value written with kubectl in a form the form would not take stays as it is.
export function UserBudgetDialog({ entry, defaults, onClose }: Props) {
  const setBudget = useSetUserBudget();
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState<Record<Field, string>>({
    cpu: entry?.cpu ?? "",
    memory: entry?.memory ?? "",
    storage: entry?.storage ?? "",
  });
  const fields: Field[] =
    defaults.storage !== null || entry?.storage
      ? ["cpu", "memory", "storage"]
      : ["cpu", "memory"];
  const user = entry
    ? userBudgetUserSchema.safeParse({ ownerSub: entry.ownerSub })
    : userBudgetUserSchema.safeParse({ email });
  const parsed = Object.fromEntries(
    fields.map((field) => {
      const text = draft[field].trim();
      if (text === "") return [field, { ok: true, value: null }];
      if (text === entry?.[field]) return [field, { ok: true, value: text }];
      const result = FIELDS[field].schema.safeParse(text);
      return [
        field,
        result.success
          ? { ok: true, value: result.data }
          : { ok: false, value: null },
      ];
    }),
  ) as Record<Field, { ok: boolean; value: string | null }>;
  const change: Partial<Record<Field, string | null>> = {};
  for (const field of fields) {
    const was = entry?.[field] ?? null;
    if (parsed[field].ok && parsed[field].value !== was) {
      change[field] = parsed[field].value;
    }
  }
  const allValid = fields.every((field) => parsed[field].ok);
  const pending = setBudget.isPending;
  const canSave =
    user.success && allValid && Object.keys(change).length > 0 && !pending;
  const placeholder: Record<Field, string> = {
    cpu: defaults.cpu,
    memory: defaults.memory,
    storage: defaults.storage ?? "",
  };

  return (
    <OperatorOverrideDialog
      title={entry ? "Change compute budget" : SET_BUDGET}
      subtitle={
        entry
          ? `For ${entry.email ?? entry.ownerSub}. ${BUDGET_APPLIES_NEXT_START}`
          : BUDGET_APPLIES_NEXT_START
      }
      user={
        entry
          ? null
          : {
              value: email,
              valid: user.success,
              onChange: (text) => {
                setEmail(text);
                setBudget.reset();
              },
            }
      }
      failure={setBudget.error}
      errorCopy={{
        removedMeanwhile: BUDGET_REMOVED_MEANWHILE,
        saveFailed: BUDGET_SAVE_FAILED,
        showServerMessage: true,
      }}
      fields={fields.map((field, index) => ({
        label: FIELDS[field].label,
        hint: `${FIELDS[field].hint} Empty uses the default.`,
        placeholder: placeholder[field],
        error: parsed[field].ok ? undefined : FIELDS[field].invalid,
        value: draft[field],
        autoFocus: entry !== null && index === 0,
        onChange: (text) => {
          setDraft({ ...draft, [field]: text });
          setBudget.reset();
        },
      }))}
      pending={pending}
      canSave={canSave}
      onSave={() => {
        if (!user.success) return;
        const input: UserBudgetSetInput = { user: user.data, ...change };
        setBudget.mutate(input, { onSuccess: onClose });
      }}
      onClose={onClose}
    />
  );
}
