interface Opening {
  id: Promise<string | null>;
  done: boolean;
}

export interface TabTarget {
  open(id: Promise<string | null>): void;
  target(shown: () => string | undefined): Promise<string | undefined>;
  reported(activeTab: string | null | undefined): void;
  clear(): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: which tab the panel's address bar and toolbar act
 * on. It is the tab the panel shows, except right after "New tab": the runtime
 * reports the new tab only once it has attached and polled it, so until it
 * does, an action waits for the new tab's id and acts on that tab, never on the
 * tab shown before. A failed new tab, a select or close, or the next report of
 * the tabs after the id is known ends the wait.
 */
export function createTabTarget(): TabTarget {
  let opening: Opening | null = null;
  let lastActive: string | null = null;

  const settle = (entry: Opening) => {
    if (opening === entry) opening = null;
  };

  return {
    open(id) {
      const entry: Opening = { id, done: false };
      entry.id = id.then((tab) => {
        entry.done = true;
        if (!tab || lastActive === tab) settle(entry);
        return tab;
      });
      opening = entry;
    },
    async target(shown) {
      const entry = opening;
      return (entry && (await entry.id)) ?? shown();
    },
    reported(activeTab) {
      lastActive = activeTab ?? null;
      if (opening?.done) opening = null;
    },
    clear() {
      opening = null;
    },
  };
}
