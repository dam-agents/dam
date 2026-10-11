import { Checkmark, Edit } from "@carbon/icons-react";
import type { AvatarMood } from "api-server-api/avatar/svg";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useUpdateAgent } from "../api/mutations.js";
import { AgentAvatar, resolveCharacter } from "./avatar/agent-avatar.js";
import { AvatarGrid } from "./avatar/avatar-picker.js";

const PENCIL_BADGE =
  "flex shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground";
const REVEAL_ON_HOVER =
  "opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's avatar and name, each editable in
 * place and saved on confirm. The chat header and the agent configuration
 * header share it so both rename and re-skin the agent the same way.
 */
export function EditableAgentIdentity({
  agent,
  avatarSize,
  mood,
  avatarClassName,
  nameClassName,
  nameTag: NameTag = "h1",
}: {
  agent: AgentView;
  avatarSize: number;
  mood: AvatarMood;
  avatarClassName?: string;
  nameClassName?: string;
  nameTag?: "h1" | "h2";
}) {
  const updateAgent = useUpdateAgent();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const pending = updateAgent.isPending ? updateAgent.variables : undefined;
  const name = pending?.name ?? agent.name;
  const avatar = pending?.avatar ?? agent.avatar;
  const character = resolveCharacter(name, avatar);

  const commitName = () => {
    const next = draft?.trim();
    setDraft(null);
    if (!next || next === agent.name) return;
    const keepNameDerivedAvatar = agent.avatar ? {} : { avatar: character };
    updateAgent.mutate({ id: agent.id, name: next, ...keepNameDerivedAvatar });
  };

  return (
    <>
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger
          type="button"
          aria-label={`Avatar: ${character}. Choose an avatar`}
          className={cn("group relative shrink-0 rounded-md", avatarClassName)}
        >
          <AgentAvatar
            name={name}
            avatar={avatar}
            size={avatarSize}
            mood={mood}
          />
          <span
            className={cn(
              PENCIL_BADGE,
              REVEAL_ON_HOVER,
              "absolute -right-1 -bottom-1 size-4",
            )}
          >
            <Edit size={10} />
          </span>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <AvatarGrid
            value={character}
            onPick={(next) => {
              setPickerOpen(false);
              if (next !== character)
                updateAgent.mutate({ id: agent.id, avatar: next });
            }}
          />
        </PopoverContent>
      </Popover>
      {draft === null ? (
        <NameTag className={cn("flex min-w-0", nameClassName)}>
          <button
            type="button"
            onClick={() => setDraft(name)}
            title={`Rename ${name}`}
            className="group flex min-w-0 items-center gap-1.5 text-left"
          >
            <span className="truncate">{name}</span>
            <span
              aria-hidden
              className={cn(PENCIL_BADGE, REVEAL_ON_HOVER, "size-5")}
            >
              <Edit size={12} />
            </span>
          </button>
        </NameTag>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5">
          <input
            autoFocus
            aria-label="Agent name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.target.select()}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") setDraft(null);
            }}
            className={cn(
              "min-w-0 flex-1 rounded-sm bg-transparent px-1 -mx-1 outline-hidden ring-1 ring-border focus-visible:ring-ring",
              nameClassName,
            )}
          />
          <button
            type="button"
            aria-label="Save name"
            onMouseDown={(e) => e.preventDefault()}
            onClick={commitName}
            className={cn(PENCIL_BADGE, "size-5")}
          >
            <Checkmark size={12} />
          </button>
        </span>
      )}
    </>
  );
}
