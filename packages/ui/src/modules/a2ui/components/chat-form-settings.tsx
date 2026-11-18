import type { ChatFormPreferences } from "api-server-api/chat-forms";

import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleRow } from "@/components/ui/toggle-row";

import { OptionField } from "../../sessions/components/option-field.js";
import {
  useChatFormPreferences,
  useSetChatFormPreferences,
} from "../api/queries.js";

type Choice<K extends keyof ChatFormPreferences> = {
  value: ChatFormPreferences[K];
  label: string;
};

const FORMS: Choice<"forms">[] = [
  { value: "all", label: "For questions and results" },
  { value: "input", label: "Only for questions" },
  { value: "off", label: "Never (plain text only)" },
];
const PACING: Choice<"pacing">[] = [
  { value: "agent", label: "Agent decides" },
  { value: "together", label: "All at once" },
  { value: "one-at-a-time", label: "One at a time" },
];
const RECOMMEND: Choice<"recommend">[] = [
  { value: "preselect", label: "Pick for me and say why" },
  { value: "mark", label: "Recommend, I pick" },
  { value: "off", label: "No suggestions" },
];

function ChoiceField<K extends "forms" | "pacing" | "recommend">({
  title,
  choices,
  value,
  onChange,
}: {
  title: string;
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
    </OptionField>
  );
}

export function ChatFormSettings({ agentId }: { agentId: string }) {
  const { data } = useChatFormPreferences(agentId);
  const save = useSetChatFormPreferences();
  if (!data) return null;

  const preferences = save.isPending ? save.variables.preferences : data;
  const update = (patch: Partial<ChatFormPreferences>) =>
    save.mutate({ agentId, preferences: { ...preferences, ...patch } });

  return (
    <section className="mb-8">
      <ChoiceField
        title="When to use them"
        choices={FORMS}
        value={preferences.forms}
        onChange={(forms) => update({ forms })}
      />
      {preferences.forms !== "off" && (
        <>
          <ChoiceField
            title="Questions per form"
            choices={PACING}
            value={preferences.pacing}
            onChange={(pacing) => update({ pacing })}
          />
          <ChoiceField
            title="Suggested answers"
            choices={RECOMMEND}
            value={preferences.recommend}
            onChange={(recommend) => update({ recommend })}
          />
          <OptionField title="Chat input">
            <ToggleRow
              title="Lock the message box during quick questions"
              checked={preferences.lockComposer}
              onCheckedChange={(lockComposer) => update({ lockComposer })}
            />
          </OptionField>
        </>
      )}
      <p role="status" className="mt-4 min-h-5 text-sm text-muted-foreground">
        {save.isSuccess && "Saved."}
      </p>
    </section>
  );
}
