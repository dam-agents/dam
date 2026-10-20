import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Approach = 1 | 2 | 3;

export interface FreeBudget {
  used: number;
  limit: number;
  unit: "usd";
  resetsAt: null;
}

export interface InstantStartState {
  approach: Approach | null;
  freeBudget: FreeBudget;
  budgetExhausted: boolean;
  setBudgetExhausted: (v: boolean) => void;
  providerAdded: boolean;
  setProviderAdded: (v: boolean) => void;
  agentCreated: boolean;
  setAgentCreated: (v: boolean) => void;
  firstLanding: boolean;
  setFirstLanding: (v: boolean) => void;
  curveBenderEnabled: boolean;
  setCurveBenderEnabled: (v: boolean) => void;
}

const INITIAL_BUDGET: FreeBudget = {
  used: 0,
  limit: 20.0,
  unit: "usd",
  resetsAt: null,
};

const EXHAUSTED_BUDGET: FreeBudget = {
  used: 20.0,
  limit: 20.0,
  unit: "usd",
  resetsAt: null,
};

const InstantStartContext = createContext<InstantStartState | null>(null);

export function useInstantStart(): InstantStartState | null {
  return useContext(InstantStartContext);
}

export function useInstantStartRequired(): InstantStartState {
  const ctx = useContext(InstantStartContext);
  if (!ctx) throw new Error("useInstantStartRequired outside provider");
  return ctx;
}

function readApproachParam(): Approach | null {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("start");
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return null;
}

export function InstantStartProvider({ children }: { children: ReactNode }) {
  const [approach] = useState(readApproachParam);
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  const [providerAdded, setProviderAdded] = useState(false);
  const [agentCreated, setAgentCreated] = useState(false);
  const [firstLanding, setFirstLanding] = useState(false);
  const [curveBenderEnabled, setCurveBenderEnabled] = useState(true);

  useEffect(() => {
    if (providerAdded) setCurveBenderEnabled(false);
  }, [providerAdded]);

  const state = useMemo<InstantStartState>(
    () => ({
      approach,
      freeBudget: budgetExhausted ? EXHAUSTED_BUDGET : INITIAL_BUDGET,
      budgetExhausted,
      setBudgetExhausted,
      providerAdded,
      setProviderAdded,
      agentCreated,
      setAgentCreated,
      firstLanding,
      setFirstLanding,
      curveBenderEnabled,
      setCurveBenderEnabled,
    }),
    [approach, budgetExhausted, providerAdded, agentCreated, firstLanding, curveBenderEnabled],
  );

  if (!approach) return <>{children}</>;

  return (
    <InstantStartContext.Provider value={state}>
      {children}
    </InstantStartContext.Provider>
  );
}
