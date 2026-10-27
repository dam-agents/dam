export interface ChatDefaultView {
  resolved: boolean;
  model: string | null;
}

export function chatDefaultView(
  pair: { model: string | null } | null | undefined,
): ChatDefaultView | undefined {
  if (pair === undefined) return undefined;
  if (pair === null || pair.model === null) {
    return { resolved: false, model: null };
  }
  return { resolved: true, model: pair.model };
}

// UNIT_BOUNDARY_DESCRIPTION: the release starts a chat from the saved pair, so the old model control shows that model. With no pair saved yet it shows the harness setting, as 0.2.23 did.
export function shownModel(
  pair: ChatDefaultView | undefined,
  harnessModel: string | null,
): string | null {
  return pair?.resolved ? pair.model : harnessModel;
}

// UNIT_BOUNDARY_DESCRIPTION: a model choice is a change when it differs from what the field shows, and also when no chat pair is saved at all: the release refuses a run without one, so picking the value already shown is what saves it.
export function modelIsDirty(
  pair: ChatDefaultView | undefined,
  chosen: string | null,
  baseline: string | null,
): boolean {
  if (pair !== undefined && !pair.resolved) return chosen !== null;
  return chosen !== baseline;
}
