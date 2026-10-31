import {
  UI_EVENTS_MAX_BATCH,
  type UiFlow,
  type UiFlowStep,
} from "api-server-api";
import { useEffect } from "react";

import { api } from "../../../api.js";
import { useStore } from "../../../store.js";
import { parseRoute } from "../../platform/lib/routes.js";
import { onRequestLatency } from "./request-latency.js";
import { elementOf, routePattern } from "./ui-elements.js";
import { createUiRecorder, type UiRecorder } from "./ui-recorder.js";

const FLUSH_MS = 10_000;
const DEAD_CLICK_MS = 1_000;
const DIALOG_OPENER_MS = 1_000;
const SLOW_REQUEST_MS = 3_000;
const JS_ERROR_GAP_MS = 1_000;
const MAX_BATCHES_PER_FLUSH = 4;
const SELF_PATH = "usage.uiEvents";

const INTERACTIVE =
  "a,button,input,select,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=option]";
const DIALOG = "[role=dialog],[role=alertdialog]";
const TOAST =
  "[data-sonner-toast][data-type=error],[data-sonner-toast][data-type=warning]";
const ALERT = "[role=alert]";
const DISMISS = /\b(cancel|close|dismiss|discard)\b/i;

interface OpenDialog {
  element: string | null;
  interacted: boolean;
  lastButton: "action" | null;
}

let recorder: UiRecorder | null = null;

export function recordFlowStep(flow: UiFlow, step: UiFlowStep): void {
  recorder?.flowStep(flow, step);
}

export function useFlowOpened(flow: UiFlow, enabled = true): void {
  useEffect(() => {
    if (enabled) recordFlowStep(flow, "open");
  }, [flow, enabled]);
}

export function withFlowSteps<A extends unknown[], R>(
  flow: UiFlow,
  run: (...args: A) => Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args) => {
    recordFlowStep(flow, "submit");
    const result = await run(...args);
    recordFlowStep(flow, "done");
    return result;
  };
}

const testIdOf = (el: Element | null | undefined): string | null => {
  const testId = el?.getAttribute("data-testid");
  return testId ? elementOf(testId) : null;
};

const sanitizedBuild = (value: string): string =>
  value.replace(/[^A-Za-z0-9._+-]/g, "_").slice(0, 64) || "unknown";

const within = <T extends Element>(node: Element, selector: string): T[] => [
  ...(node.matches(selector) ? [node as T] : []),
  ...node.querySelectorAll<T>(selector),
];

export async function startUiTelemetry(): Promise<void> {
  const settings = await api.usage.uiTelemetry.query().catch(() => null);
  if (!settings?.enabled || recorder) return;
  installUiTelemetry(sanitizedBuild(settings.build));
}

function installUiTelemetry(build: string): void {
  const rec = createUiRecorder(() => performance.now());
  recorder = rec;
  const tab = crypto.randomUUID();

  let path: string | null = null;
  const syncRoute = () => {
    if (location.pathname === path) return;
    path = location.pathname;
    rec.routeChanged(
      routePattern(parseRoute(location.pathname, location.search)),
    );
  };
  syncRoute();
  useStore.subscribe(() => {
    syncRoute();
    setTimeout(syncRoute);
  });
  window.addEventListener("popstate", syncRoute);

  let lastMutationAt = 0;
  let lastAction: { element: string; at: number } | null = null;
  const dialogs = new Map<Element, OpenDialog>();
  const dialogOf = (target: EventTarget | null) =>
    target instanceof Element
      ? dialogs.get(target.closest(DIALOG) ?? target)
      : undefined;

  const noticeAdded = (node: Element) => {
    within(node, TOAST).forEach(() => rec.errorShown(null));
    for (const alert of within(node, ALERT)) {
      if (!alert.closest("[data-sonner-toaster]")) {
        rec.errorShown(testIdOf(alert.closest("[data-testid]")));
      }
    }
    for (const dialog of within(node, DIALOG)) {
      const opener =
        lastAction && performance.now() - lastAction.at <= DIALOG_OPENER_MS
          ? lastAction.element
          : null;
      dialogs.set(dialog, {
        element: testIdOf(dialog) ?? opener,
        interacted: false,
        lastButton: null,
      });
    }
  };

  const closeDetachedDialogs = () => {
    for (const [dialog, state] of dialogs) {
      if (dialog.isConnected) continue;
      dialogs.delete(dialog);
      if (state.interacted && state.lastButton !== "action") {
        rec.signal("abandoned_dialog", state.element);
      }
    }
  };

  new MutationObserver((records) => {
    lastMutationAt = performance.now();
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) noticeAdded(node);
      }
    }
    if (dialogs.size > 0) closeDetachedDialogs();
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;
      const dialog = dialogOf(target);
      const button = target.closest("button,[role=button]");
      if (dialog && button) {
        const label = [
          button.getAttribute("data-testid"),
          button.getAttribute("aria-label"),
          button.textContent,
        ].join(" ");
        dialog.lastButton = DISMISS.test(label) ? null : "action";
      }
      const element = testIdOf(target.closest("[data-testid]"));
      if (!element) return;
      const at = performance.now();
      rec.click(element);
      lastAction = { element, at };
      if (!target.closest(INTERACTIVE)) return;
      const clickedOn = location.pathname;
      setTimeout(() => {
        if (lastMutationAt < at && location.pathname === clickedOn) {
          rec.signal("dead_click", element);
        }
      }, DEAD_CLICK_MS);
    },
    true,
  );

  document.addEventListener(
    "input",
    (event) => {
      const dialog = dialogOf(event.target);
      if (!dialog) return;
      dialog.interacted = true;
      dialog.lastButton = null;
    },
    true,
  );
  document.addEventListener(
    "submit",
    (event) => {
      const dialog = dialogOf(event.target);
      if (dialog) dialog.lastButton = "action";
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      for (const dialog of dialogs.values()) dialog.lastButton = null;
    },
    true,
  );

  let lastJsErrorAt = -Infinity;
  const jsError = () => {
    const at = performance.now();
    if (at - lastJsErrorAt < JS_ERROR_GAP_MS) return;
    lastJsErrorAt = at;
    rec.signal("js_error", null);
  };
  window.addEventListener("error", (event) => {
    if (event instanceof ErrorEvent) jsError();
  });
  window.addEventListener("unhandledrejection", jsError);

  onRequestLatency((procedure, elapsedMs) => {
    if (elapsedMs < SLOW_REQUEST_MS || procedure === SELF_PATH) return;
    rec.signal("slow_request", elementOf(`trpc:${procedure}`), elapsedMs);
  });

  const flush = () => {
    for (let i = 0; i < MAX_BATCHES_PER_FLUSH && rec.size() > 0; i++) {
      const events = rec.drain(UI_EVENTS_MAX_BATCH);
      void api.usage.uiEvents.mutate({ tab, build, events }).catch(() => {});
    }
  };
  setInterval(flush, FLUSH_MS);
  const leave = () => {
    rec.hidden();
    flush();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
  });
  window.addEventListener("pagehide", leave);
}
