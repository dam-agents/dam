const BACK_ENTRY = "back-entry";

let held: { close: () => void; url: string } | null = null;
let ownPops = 0;

const currentUrl = () =>
  `${location.pathname}${location.search}${location.hash}`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: A view that covers the page on a phone, such as
 * the full-screen side panel, looks like a page of its own, so the phone's
 * Back gesture must close it instead of leaving the page under it. While the
 * view is open it holds a history entry at the same URL, and a Back that
 * leaves that entry for the same URL closes the view; `takeBackPress` then
 * tells the router not to apply a route. A view closed any other way pops
 * its entry itself, so the next Back still leaves the page. The entry is
 * pushed once and popped a tick after its release, so an unmount and a
 * remount in the same tick share one entry.
 */
export function holdBackEntry(close: () => void): () => void {
  if (history.state !== BACK_ENTRY) history.pushState(BACK_ENTRY, "");
  const hold = { close, url: currentUrl() };
  held = hold;
  return () => {
    if (held !== hold) return;
    held = null;
    setTimeout(() => {
      if (held !== null || history.state !== BACK_ENTRY) return;
      if (currentUrl() !== hold.url) return;
      ownPops++;
      history.back();
    });
  };
}

export function takeBackPress(): boolean {
  if (ownPops > 0) {
    ownPops--;
    return true;
  }
  const hold = held;
  if (hold === null || history.state === BACK_ENTRY) return false;
  if (currentUrl() !== hold.url) return false;
  held = null;
  hold.close();
  return true;
}
