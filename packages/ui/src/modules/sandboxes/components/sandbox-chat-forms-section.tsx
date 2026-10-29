import { SectionLabel } from "@/components/ui/section-label";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function SandboxChatFormsSection({ agentId }: { agentId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SectionLabel>Form usage</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {(
            ["Whenever they help", "Only to ask for input", "Off"] as const
          ).map((opt, i) => (
            <label
              key={opt}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <input
                type="radio"
                name="chat-forms"
                defaultChecked={i === 0}
                className="accent-foreground"
              />
              {opt}
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <SectionLabel>Pacing</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {(["Show several at once", "One at a time"] as const).map(
            (opt, i) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-sm text-foreground"
              >
                <input
                  type="radio"
                  name="chat-forms-pacing"
                  defaultChecked={i === 0}
                  className="accent-foreground"
                />
                {opt}
              </label>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
