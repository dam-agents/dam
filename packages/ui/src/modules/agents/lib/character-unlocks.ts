import { useSyncExternalStore } from "react";

import { CHAR_NAMES, type CharName } from "../components/char-avatar.js";

export interface CharacterQuest {
  id: string;
  title: string;
  cta: string;
}

export const FIRST_AGENT_QUEST_ID = "first-agent";

export const CHARACTER_QUESTS: readonly CharacterQuest[] = [
  { id: FIRST_AGENT_QUEST_ID, title: "Create your first agent", cta: "Create" },
  { id: "connect-github", title: "Connect GitHub", cta: "Connect" },
  { id: "add-skill", title: "Add a skill", cta: "Add" },
  { id: "add-schedule", title: "Schedule a recurring task", cta: "Schedule" },
  { id: "slack", title: "Talk to an agent in Slack", cta: "Open" },
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

export function markCharacterSeen(name: CharName) {
  if (!state.fresh.has(name)) return;
  const fresh = new Set(state.fresh);
  fresh.delete(name);
  setState({ fresh });
}

export function resetCharacterUnlocks() {
  if (workTimer) clearTimeout(workTimer);
  workTimer = null;
  setState(initialState());
}
