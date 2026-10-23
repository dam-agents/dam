import { useSyncExternalStore } from "react";

import { CHAR_NAMES, type CharName } from "../components/char-avatar.js";

export interface QuestAction {
  label: string;
  view?: "home" | "agent-new" | "packs" | "artifacts";
  settingsTab?:
    | "connections"
    | "providers"
    | "account"
    | "appearance"
    | "api-keys"
    | "usage"
    | "features";
  sandbox?: "connections" | "skills" | "schedules" | "channels";
  prefill?: string;
}

export interface CharacterQuest {
  id: string;
  title: string;
  help: string;
  action: QuestAction;
}

export const FIRST_AGENT_QUEST_ID = "first-agent";

export const CHARACTER_QUESTS: readonly CharacterQuest[] = [
  {
    id: FIRST_AGENT_QUEST_ID,
    title: "Create your first agent",
    help: "Click + next to Agents in the sidebar. Give it a name, pick a harness and a provider, then click Create agent.",
    action: { label: "Create an agent", view: "agent-new" },
  },
  {
    id: "first-message",
    title: "Send your agent a message",
    help: "Open your agent from the sidebar and type what you want it to do in the chat box at the bottom.",
    action: {
      label: "Open chat",
      prefill: "Hello! What can you help me with?",
    },
  },
  {
    id: "connect-github",
    title: "Create a connection",
    help: "Go to Settings, then Connections. Add a connection so your agents can access external services.",
    action: { label: "Open connections", settingsTab: "connections" },
  },
  {
    id: "add-skill",
    title: "Add a skill",
    help: "Open an agent's settings and go to Skills. Add a skill source from a Git repo to teach it something new.",
    action: { label: "Go to skills", sandbox: "skills" },
  },
  {
    id: "starter-kit",
    title: "Try a starter kit",
    help: "Go to Starter Kits in the sidebar and pick one. It sets up a new agent with skills and connections already in place.",
    action: { label: "Browse packs", view: "packs" },
  },
  {
    id: "add-schedule",
    title: "Schedule a recurring task",
    help: "Ask your agent in chat to do something on a schedule, like every weekday morning, or add one in the agent's Schedules.",
    action: {
      label: "Ask for a schedule",
      prefill: "Run this task every weekday at 9am:",
    },
  },
  {
    id: "save-artifact",
    title: "Create an artifact",
    help: "When an agent makes a file you want to keep, save it from the chat. Saved files live in Artifacts in the sidebar.",
    action: { label: "View artifacts", view: "artifacts" },
  },
  {
    id: "slack",
    title: "Use your agent in Slack",
    help: "Connect Slack in Settings, then Channels. Add your agent to a channel and @mention it.",
    action: { label: "Set up Slack", sandbox: "channels" },
  },
];

const WORK_MS = 700;

interface UnlockState {
  caught: readonly CharName[];
  unlocked: ReadonlySet<CharName>;
  fresh: ReadonlySet<CharName>;
  rewards: ReadonlyMap<string, CharName>;
  working: string | null;
  celebrating: { name: CharName; questId: string } | null;
  collected: CharName | null;
  pickerRequest: number;
  checklistRequest: number;
}

const initialState = (): UnlockState => ({
  caught: [],
  unlocked: new Set(),
  fresh: new Set(),
  rewards: new Map(),
  working: null,
  celebrating: null,
  collected: null,
  pickerRequest: 0,
  checklistRequest: 0,
});

let state: UnlockState = initialState();
let workTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function setState(patch: Partial<UnlockState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCharacterUnlocks(): UnlockState {
  return state;
}

export function useCharacterUnlocks(): UnlockState {
  return useSyncExternalStore(subscribe, () => state);
}

export function completeQuest(questId: string) {
  if (state.working || state.celebrating || state.rewards.has(questId)) return;
  setState({ working: questId });
  workTimer = setTimeout(() => {
    workTimer = null;
    const pool = CHAR_NAMES.filter((n) => !state.unlocked.has(n));
    const reward = pool[Math.floor(Math.random() * pool.length)];
    if (!reward) {
      setState({ working: null });
      return;
    }
    const caught = [...state.caught, reward];
    const rewards = new Map(state.rewards);
    rewards.set(questId, reward);
    const fresh = new Set(state.fresh);
    if (questId !== FIRST_AGENT_QUEST_ID) fresh.add(reward);
    setState({
      working: null,
      caught,
      unlocked: new Set(caught),
      rewards,
      fresh,
      celebrating: { name: reward, questId },
    });
  }, WORK_MS);
}

export function endCelebration() {
  if (!state.celebrating) return;
  setState({ collected: state.celebrating.name, celebrating: null });
}

export function requestCharacterPicker() {
  setState({ pickerRequest: state.pickerRequest + 1 });
}

export function requestChecklist() {
  setState({ checklistRequest: state.checklistRequest + 1 });
}

export function markCharacterSeen(name: CharName) {
  if (!state.fresh.has(name)) return;
  const fresh = new Set(state.fresh);
  fresh.delete(name);
  setState({ fresh });
}

export function unlockAllCharacters() {
  if (workTimer) clearTimeout(workTimer);
  workTimer = null;
  const all = [...CHAR_NAMES] as CharName[];
  const rewards = new Map<string, CharName>();
  for (let i = 0; i < CHARACTER_QUESTS.length; i++) {
    rewards.set(CHARACTER_QUESTS[i]!.id, all[i]!);
  }
  setState({
    caught: all,
    unlocked: new Set(all),
    fresh: new Set(),
    rewards,
    working: null,
    celebrating: null,
    collected: null,
    pickerRequest: 0,
    checklistRequest: 0,
  });
}

export function resetCharacterUnlocks() {
  if (workTimer) clearTimeout(workTimer);
  workTimer = null;
  setState(initialState());
}
