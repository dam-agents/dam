import type { ChatFormPreferences } from "api-server-api/chat-forms";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";

import { OptionField } from "../../sessions/components/option-field.js";
import {
  useChatFormPreferences,
  useSetChatFormPreferences,
} from "../api/queries.js";
import { useChatFormsEnabled } from "../hooks/use-chat-forms-enabled.js";

type Choice<K extends keyof ChatFormPreferences> = {
  value: ChatFormPreferences[K];
  label: string;
};

const FORMS: Choice<"forms">[] = [
  { value: "all", label: "Whenever they help" },
  { value: "input", label: "Only to ask for input" },
  { value: "off", label: "Off" },
];
const PACING: Choice<"pacing">[] = [
  { value: "agent", label: "Agent decides" },
  { value: "together", label: "All in one form" },
  { value: "one-at-a-time", label: "One at a time" },
];
const RECOMMEND: Choice<"recommend">[] = [
  { value: "preselect", label: "Preselect and mark" },
  { value: "mark", label: "Only mark" },
  { value: "off", label: "Don't recommend" },
];

function ChoiceField<K extends "forms" | "pacing" | "recommend">({
  title,
  hint,
  choices,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  choices: Choice<K>[];
  value: ChatFormPreferences[K];
  onChange: (value: ChatFormPreferences[K]) => void;
}) {
  return (
    <OptionField title={title}>
      <RadioGroup
        aria-label={title}
        className="flex-row flex-wrap gap-x-6 gap-y-2"
        value={value}
        onValueChange={(next) => onChange(next as ChatFormPreferences[K])}
      >
        {choices.map((choice) => (
          <RadioGroupItem
            key={choice.value}
            value={choice.value}
            label={choice.label}
            className="w-auto"
          />
        ))}
      </RadioGroup>
      <p className="mt-1.5 text-sm text-muted-foreground">{hint}</p>
    </OptionField>
  );
}

export function ChatFormSettings({ agentId }: { agentId: string }) {
  const enabled = useChatFormsEnabled();
  const { data } = useChatFormPreferences(agentId);
  const save = useSetChatFormPreferences();
  if (!enabled)
    return (
      <p className="text-sm text-muted-foreground">
        Chat forms are an experimental feature, and it is off for your account.
      </p>
    );
  if (!data) return null;

  const preferences = save.isPending ? save.variables.preferences : data;
  const update = (patch: Partial<ChatFormPreferences>) =>
    save.mutate({ agentId, preferences: { ...preferences, ...patch } });

  return (
    <section className="mb-8">
      <ChoiceField
        title="Forms"
        hint="When the agent may put forms, choices and cards into its replies in the web chat."
        choices={FORMS}
        value={preferences.forms}
        onChange={(forms) => update({ forms })}
      />
      {preferences.forms !== "off" && (
        <>
          <ChoiceField
            title="Questions"
            hint="Whether the agent asks everything at once or one question per form."
            choices={PACING}
            value={preferences.pacing}
            onChange={(pacing) => update({ pacing })}
          />
          <ChoiceField
            title="Recommendations"
            hint="Whether the agent fills in the answer it recommends, only marks it, or leaves the choice to you."
            choices={RECOMMEND}
            value={preferences.recommend}
            onChange={(recommend) => update({ recommend })}
          />
          <label className="mt-6 flex cursor-pointer items-start justify-between gap-4">
            <span>
              <span className="block text-sm font-medium text-foreground">
                Lock the chat input
              </span>
              <span className="mt-0.5 block text-sm text-muted-foreground">
                Let the agent lock the message box until you answer a short
                form.
              </span>
            </span>
            <Switch
              label="Lock the chat input"
              checked={preferences.lockComposer}
              onCheckedChange={(lockComposer) => update({ lockComposer })}
            />
          </label>
        </>
      )}
      <p role="status" className="mt-4 min-h-5 text-sm text-muted-foreground">
        {save.isSuccess && "Saved."}
      </p>
    </section>
  );
}
