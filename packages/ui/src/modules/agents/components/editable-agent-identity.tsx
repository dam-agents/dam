import { Checkmark, TextCreation } from "@carbon/icons-react";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import type { AgentView } from "../../../types.js";
import { useFreshAvatars } from "../../getting-started/hooks/use-unlocked-avatars.js";
import { useUpdateAgent } from "../api/mutations.js";
import {
  AgentAvatar,
  type AgentAvatarMood,
  resolveCharacter,
} from "./avatar/agent-avatar.js";
import { AvatarPicker } from "./avatar/avatar-picker.js";
import { NewAvatarDot } from "./avatar/new-avatar-dot.js";

const ICON_BUTTON = "shrink-0 text-muted-foreground hover:text-foreground";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The agent's avatar and name, each editable in
 * place and saved on confirm, in the agent configuration header.
 */
export function EditableAgentIdentity({
  agent,
  ...display
}: {
  agent: AgentView;
} & IdentityDisplay) {
  const rename = useUpdateAgent();
  const changeAvatar = useUpdateAgent();
  const name =
    (rename.isPending ? rename.variables.name : undefined) ?? agent.name;
  const avatar =
    (changeAvatar.isPending ? changeAvatar.variables.avatar : undefined) ??
    (rename.isPending ? rename.variables.avatar : undefined) ??
    agent.avatar;
  return (
    <EditableIdentity
      {...display}
      name={name}
      avatar={avatar}
      onRename={(next) => {
        if (next === agent.name) return;
        const keepNameDerivedAvatar = agent.avatar
          ? {}
          : { avatar: resolveCharacter(name, avatar) };
        rename.mutate({ id: agent.id, name: next, ...keepNameDerivedAvatar });
      }}
      onAvatarChange={(next) =>
        changeAvatar.mutate({ id: agent.id, avatar: next })
      }
    />
  );
}

interface IdentityDisplay {
  avatarSize: number;
  mood: AgentAvatarMood;
  nameClassName?: string;
  nameTag?: "h1" | "h2";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An avatar and a name, each editable in place and
 * reported on confirm, for an agent that exists or one about to be created.
 */
export function EditableIdentity({
  name,
  avatar,
  onRename,
  onAvatarChange,
  avatarSize,
  mood,
  nameClassName,
  nameTag: NameTag = "h1",
}: {
  name: string;
  avatar: string | null | undefined;
  onRename: (name: string) => void;
  onAvatarChange: (avatar: string) => void;
} & IdentityDisplay) {
  const hasNewAvatar = useFreshAvatars().length > 0;
  const [draft, setDraft] = useState<string | null>(null);
  const editEnded = useRef(false);
  const current =
    avatar?.startsWith("emoji:") || avatar?.startsWith("image:")
      ? avatar
      : resolveCharacter(name, avatar);

  const startEdit = () => {
    editEnded.current = false;
    setDraft(name);
  };
  const cancelEdit = () => {
    editEnded.current = true;
    setDraft(null);
  };
  const commitName = () => {
    if (editEnded.current) return;
    editEnded.current = true;
    const next = draft?.trim();
    setDraft(null);
    if (next) onRename(next);
  };

  return (
    <>
      <AvatarPicker value={current} onChange={onAvatarChange}>
        <AgentAvatar
          name={name}
          avatar={avatar}
          size={avatarSize}
          mood={mood}
        />
        {hasNewAvatar && <NewAvatarDot className="-top-1 -right-1" />}
      </AvatarPicker>
      {draft === null ? (
        <NameTag className={cn("flex min-w-0", nameClassName)}>
          <button
            type="button"
            onClick={startEdit}
            title={`Rename ${name}`}
            className="flex min-w-0 items-center gap-1.5 text-left"
          >
            <span className="truncate">{name}</span>
            <TextCreation aria-hidden size={16} className={ICON_BUTTON} />
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
              if (e.key === "Escape") cancelEdit();
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
            className={ICON_BUTTON}
          >
            <Checkmark size={16} />
          </button>
        </span>
      )}
    </>
  );
}
