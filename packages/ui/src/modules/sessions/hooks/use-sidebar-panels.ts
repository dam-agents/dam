import {
  type CSSProperties,
  type RefCallback,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  readPersistedNumber,
  writePersistedNumber,
} from "../../../lib/persisted-prefs.js";
import {
  DEFAULT_PANEL_WEIGHT,
  type DividerPair,
  dividerPairs,
  type PanelMeasure,
  panelStyle,
  panelWeightOrDefault,
  type PanelWeights,
  resizePair,
  type SidebarPanel,
  type SidebarPanelId,
} from "../lib/sidebar-panels.js";

const PANEL_TRANSITION = "transition-[flex] duration-200";

type DragOrigin = {
  pair: DividerPair;
  above: PanelMeasure;
  below: PanelMeasure;
  delta: number;
};

const WEIGHT_KEYS: Record<SidebarPanelId, string> = {
  sessions: "platform-panel-weight-sessions",
  files: "platform-panel-weight-files",
  artifacts: "platform-panel-weight-artifacts",
};

function readWeight(id: SidebarPanelId): number {
  return panelWeightOrDefault(
    readPersistedNumber(WEIGHT_KEYS[id], DEFAULT_PANEL_WEIGHT),
  );
}

function readWeights(): PanelWeights {
  return {
    sessions: readWeight("sessions"),
    files: readWeight("files"),
    artifacts: readWeight("artifacts"),
  };
}

export type SidebarPanelProps = {
  ref: RefCallback<HTMLDivElement>;
  style: CSSProperties;
  className: string | undefined;
};

export type SidebarDividerProps = {
  onResize: (delta: number) => void;
  onDragEnd: () => void;
};

export type SidebarPanelStack = {
  panelProps: (id: SidebarPanelId) => SidebarPanelProps;
  dividerProps: (below: SidebarPanelId) => SidebarDividerProps | null;
};

export function useSidebarPanels(
  panels: readonly SidebarPanel[],
): SidebarPanelStack {
  const [weights, setWeights] = useState<PanelWeights>(readWeights);
  const weightsRef = useRef(weights);
  const [dragging, setDragging] = useState(false);
  const elements = useRef(new Map<SidebarPanelId, HTMLDivElement | null>());
  const refCallbacks = useRef(
    new Map<SidebarPanelId, RefCallback<HTMLDivElement>>(),
  );

  const panelRef = useCallback((id: SidebarPanelId) => {
    const cached = refCallbacks.current.get(id);
    if (cached) return cached;
    const callback: RefCallback<HTMLDivElement> = (element) => {
      elements.current.set(id, element);
    };
    refCallbacks.current.set(id, callback);
    return callback;
  }, []);

  const measure = useCallback((id: SidebarPanelId) => {
    const element = elements.current.get(id);
    return {
      weight: weightsRef.current[id],
      px: element ? element.getBoundingClientRect().height : 0,
    };
  }, []);

  const drag = useRef<DragOrigin | null>(null);

  const resize = useCallback(
    (pair: DividerPair, delta: number) => {
      const started = drag.current;
      const origin: DragOrigin =
        started &&
        started.pair.above === pair.above &&
        started.pair.below === pair.below
          ? started
          : {
              pair,
              above: measure(pair.above),
              below: measure(pair.below),
              delta: 0,
            };
      origin.delta += delta;
      drag.current = origin;

      const resized = resizePair(origin.above, origin.below, origin.delta);
      const next: PanelWeights = { ...weightsRef.current };
      next[pair.above] = resized.above;
      next[pair.below] = resized.below;
      weightsRef.current = next;
      writePersistedNumber(WEIGHT_KEYS[pair.above], resized.above);
      writePersistedNumber(WEIGHT_KEYS[pair.below], resized.below);
      setDragging(true);
      setWeights(next);
    },
    [measure],
  );

  const endDrag = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  const pairs = dividerPairs(panels);

  return {
    panelProps: (id) => ({
      ref: panelRef(id),
      style: panelStyle(
        panels.some((panel) => panel.id === id && panel.open),
        weights[id],
      ),
      className: dragging ? undefined : PANEL_TRANSITION,
    }),
    dividerProps: (below) => {
      const pair = pairs.find((candidate) => candidate.below === below);
      if (!pair) return null;
      return { onResize: (delta) => resize(pair, delta), onDragEnd: endDrag };
    },
  };
}
