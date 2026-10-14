import { createContext, useContext } from "react";

import type { SurfaceState } from "../lib/conversation.js";
import type { FunctionCall } from "../lib/schema.js";
import type { A2uiScope } from "./a2ui-scope-context.js";

export interface A2uiEvent {
  sourceComponentId: string;
  name: string;
  userMessage: string | undefined;
  context: Record<string, unknown>;
}

export interface A2uiSurfaceState {
  surface: SurfaceState;
  dataModel: unknown;
  editable: boolean;
  touched: ReadonlySet<string>;
  setValue: (componentId: string, path: string, value: unknown) => void;
  dispatch: (event: A2uiEvent) => void;
  runLocal: (call: FunctionCall, scope: A2uiScope) => void;
}

const A2uiSurfaceContext = createContext<A2uiSurfaceState | null>(null);

export const A2uiSurfaceProvider = A2uiSurfaceContext.Provider;

export function useA2uiSurface(): A2uiSurfaceState {
  const state = useContext(A2uiSurfaceContext);
  if (!state) throw new Error("useA2uiSurface must be used inside a surface");
  return state;
}
