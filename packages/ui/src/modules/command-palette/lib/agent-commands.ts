import {
  AddComment,
  Awake,
  Branch,
  Chat,
  Copy,
  Edit,
  Exit,
  Globe,
  Power,
  Restart,
  Terminal,
  Tools,
  TrashCan,
} from "@carbon/icons-react";

import type { AgentView } from "../../../types.js";
import { holds, isLockedSection } from "../../agents/lib/agent-permissions.js";
import { cliAgentRef } from "../../sandboxes/lib/cli-agent-ref.js";
import { sessionTitleLabel } from "../../sessions/lib/session-title.js";
import {
  command,
  type CommandSpec,
  type PaletteActions,
  type PaletteCommand,
  type PaletteInput,
} from "./palette-command.js";
import { RANKING } from "./ranking.js";

const PRIOR = RANKING.PRIOR;

export function agentCommands(
  agent: AgentView,
  input: PaletteInput,
  act: PaletteActions,
  activityAt: number | undefined,
): PaletteCommand[] {
  const { route } = input;
  const here = route.agentId === agent.id;
  const inChat = here && route.view === "chat";
  const may = (permission: Parameters<typeof holds>[1]) =>
    holds(agent.access, permission);
  const of = (spec: Omit<CommandSpec, "prefix" | "agentId">) =>
    command({
      ...spec,
      id: `agent:${agent.id}:${spec.id}`,
      prefix: `agent ${agent.name}: `,
      agentId: agent.id,
    });
  const ref = cliAgentRef(agent, input.ownAgents);
  const settling = input.restarting.has(agent.id);
  const asleep =
    agent.state === "hibernated" &&
    !agent.disabled &&
    !agent.overBudget &&
    !settling;
  const session = inChat ? input.openSession : null;

  return [
    ...(may("sessions")
      ? [
          of({
            id: "new-session",
            label: "new session",
            keywords: ["chat"],
            icon: AddComment,
            prior: PRIOR.newSession,
            ...(activityAt !== undefined && { activityAt }),
            run: () => act.newSession(agent.id),
          }),
          ...input.sessions
            .filter(
              (s) =>
                s.agentId === agent.id &&
                !(inChat && s.sessionId === route.sessionId),
            )
            .map((s) =>
              command({
                id: `session:${agent.id}:${s.sessionId}`,
                prefix: `agent ${agent.name}: `,
                label: `session “${sessionTitleLabel(s)}”`,
                icon: Chat,
                prior: PRIOR.openSession,
                agentId: agent.id,
                activityAt: s.activityAt,
                run: () => act.openSession(s),
              }),
            ),
        ]
      : []),
    ...(may("terminal")
      ? [
          of({
            id: "new-terminal",
            label: "new terminal session",
            icon: Terminal,
            prior: PRIOR.terminal,
            run: () => act.newTerminal(agent.id),
          }),
          of({
            id: "copy-cli",
            label: "copy CLI chat command",
            icon: Copy,
            prior: PRIOR.copy,
            run: () =>
              act.copy(`${input.brandShort} chat ${ref}`, "CLI chat command"),
          }),
          of({
            id: "copy-ssh",
            label: "copy SSH command",
            icon: Copy,
            prior: PRIOR.copy,
            run: () =>
              act.copy(`${input.brandShort} ssh connect ${ref}`, "SSH command"),
          }),
        ]
      : []),
    ...input.sections
      .filter(
        ({ section }) =>
          !isLockedSection(agent.access, section) &&
          !(here && route.view === "sandbox-home" && route.section === section),
      )
      .map(({ section, title }) =>
        of({
          id: `configure:${section}`,
          label: `configure ${title}`,
          keywords: ["settings"],
          icon: Tools,
          prior: PRIOR.configure,
          action: `configure:${section}`,
          run: () => act.configure(agent.id, section),
        }),
      ),
    ...(inChat && input.browserOpen !== null
      ? [
          of({
            id: "toggle-browser",
            label: "toggle browser",
            icon: Globe,
            prior: PRIOR.toggle,
            run: () => act.toggleBrowser(agent.id, !input.browserOpen),
          }),
        ]
      : []),
    ...(inChat && input.changesOpen !== null
      ? [
          of({
            id: "toggle-changes",
            label: "toggle changes",
            keywords: ["diff"],
            icon: Branch,
            prior: PRIOR.toggle,
            run: () => act.toggleChanges(agent.id, !input.changesOpen),
          }),
        ]
      : []),
    ...(session
      ? [
          of({
            id: "rename-session",
            label: `rename session “${sessionTitleLabel(session)}”`,
            icon: Edit,
            prior: PRIOR.rename,
            run: () => act.renameSession(agent.id, session),
          }),
          of({
            id: "delete-session",
            label: `delete session “${sessionTitleLabel(session)}”`,
            keywords: ["remove"],
            icon: TrashCan,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.deleteSession(agent.id, session),
          }),
        ]
      : []),
    ...(may("settings")
      ? [
          of({
            id: "rename",
            label: "rename",
            icon: Edit,
            prior: PRIOR.rename,
            input: {
              kind: "input",
              label: `New name for ${agent.name}`,
              initial: agent.name,
              submit: (name) => act.renameAgent(agent, name),
            },
          }),
        ]
      : []),
    ...(may("lifecycle")
      ? [
          ...(asleep
            ? [
                of({
                  id: "wake",
                  label: "wake",
                  keywords: ["start"],
                  icon: Awake,
                  prior: PRIOR.wake,
                  run: () => act.wake(agent.id),
                }),
              ]
            : []),
          ...(agent.state === "running" && !agent.disabled && !settling
            ? [
                of({
                  id: "restart",
                  label: "restart",
                  icon: Restart,
                  prior: PRIOR.restart,
                  run: () => act.restart(agent),
                }),
              ]
            : []),
          of({
            id: "toggle-disabled",
            label: agent.disabled ? "enable" : "disable",
            icon: Power,
            prior: PRIOR.disable,
            run: () => act.toggleDisabled(agent),
          }),
        ]
      : []),
    ...(may("delete")
      ? [
          of({
            id: "delete",
            label: "delete",
            keywords: ["remove"],
            icon: TrashCan,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.deleteAgent(agent),
          }),
        ]
      : []),
    ...(agent.access.role === "editor"
      ? [
          of({
            id: "leave",
            label: "leave",
            keywords: ["remove"],
            icon: Exit,
            prior: PRIOR.destructive,
            destructive: true,
            run: () => act.leave(agent),
          }),
        ]
      : []),
  ];
}
