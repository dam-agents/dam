interface Hold {
  onBack: () => boolean;
  key: string;
  index: number;
}

let held: Hold | null = null;
let pushedKey: string | null = null;
let fromIndex: number | null = null;
let listening = false;
const ownPops: string[] = [];
const stranded = new Set<string>();

function hasNavigationApi(): boolean {
  return typeof navigation !== "undefined" && navigation.currentEntry !== null;
}

function listen(): void {
  if (listening) return;
  listening = true;
  navigation.addEventListener("currententrychange", (e) => {
    fromIndex = e.from.index;
  });
}

function pushHeldEntry(url?: string): NavigationHistoryEntry {
  history.pushState(history.state, "", url);
  const entry = navigation.currentEntry!;
  pushedKey = entry.key;
  return entry;
}

function showUrl(url: string | undefined): void {
  if (url !== undefined && url !== location.href)
    history.replaceState(history.state, "", url);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A view that covers the page on a phone, such as
 * the full-screen side panel, looks like a page of its own, so the phone's
 * Back gesture must close it instead of leaving the page under it. While the
 * view is open it holds one history entry above the page's entry, and a Back
 * from that entry asks the view to close; `takeBackPress` then tells the
 * router not to apply a route. The view can refuse, when a dialog above it
 * takes the Back, and keeps its entry. The entry is known by its Navigation
 * API key and index, which survive another writer replacing its URL or
 * state, as the session URL sync does. A view closed any other way pops its
 * entry, and the page under it shows the URL the entry had. When in-app
 * navigation pushed above the entry first, the entry is skipped on the way
 * back, so it never costs a Back of its own. The entry is pushed once and
 * popped a tick after its release, so an unmount and a remount in the same
 * tick share one entry. Without the Navigation API nothing is held, and Back
 * leaves the page as before.
 */
export function holdBackEntry(onBack: () => boolean): () => void {
  if (!hasNavigationApi()) return () => {};
  listen();
  const entry =
    navigation.currentEntry!.key === pushedKey
      ? navigation.currentEntry!
      : pushHeldEntry();
  const hold: Hold = { onBack, key: entry.key, index: entry.index };
  held = hold;
  return () => {
    if (held !== hold) return;
    held = null;
    setTimeout(() => {
      if (held !== null) return;
      pushedKey = null;
      const current = navigation.currentEntry;
      if (current?.key === hold.key) {
        ownPops.push(current.url ?? location.href);
        history.back();
      } else if (current && current.index > hold.index) {
        stranded.add(hold.key);
      }
    });
  };
}

export function takeBackPress(): boolean {
  if (!hasNavigationApi()) return false;
  const current = navigation.currentEntry!;

  const ownPopUrl = ownPops.shift();
  if (ownPopUrl !== undefined) {
    showUrl(ownPopUrl);
    return true;
  }

  if (stranded.delete(current.key)) {
    if (fromIndex !== null && fromIndex > current.index) history.back();
    else history.forward();
    return true;
  }

  const hold = held;
  if (hold === null || current.index !== hold.index - 1) return false;
  const heldUrl = navigation.entries()[hold.index]?.url ?? undefined;
  if (!hold.onBack()) {
    const entry = pushHeldEntry(heldUrl);
    hold.key = entry.key;
    hold.index = entry.index;
    return true;
  }
  held = null;
  pushedKey = null;
  showUrl(heldUrl);
  return true;
}
