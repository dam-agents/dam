/**
 * Prototype-only harness for the two Packs states that need data the platform
 * cannot produce yet: no packs at all, and the list still loading. Both are real
 * props on `PacksView`; nothing here is a design decision.
 */
import { PacksView } from "../modules/packs/views/packs-view.js";

export function PacksStates() {
  const which = new URLSearchParams(window.location.search).get("state");
  return (
    <div className="p-8">
      {which === "loading" ? <PacksView loading /> : <PacksView packs={[]} />}
    </div>
  );
}
