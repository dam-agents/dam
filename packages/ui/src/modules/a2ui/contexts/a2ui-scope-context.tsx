import { createContext, useContext } from "react";

export interface A2uiScope {
  path: string;
  indexes: readonly number[];
}

const ROOT_SCOPE: A2uiScope = { path: "", indexes: [] };

const A2uiScopeContext = createContext<A2uiScope>(ROOT_SCOPE);

export const A2uiScopeProvider = A2uiScopeContext.Provider;

export function useA2uiScope(): A2uiScope {
  return useContext(A2uiScopeContext);
}
