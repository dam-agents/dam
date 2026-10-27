import type { ReactNode } from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

import type { ProviderPresetType } from "../../types.js";

export type CurveBenderPayment = "free" | "own-key";

export type ActiveProvider = "curvebender" | ProviderPresetType;

export interface FreeBudget {
  used: number;
  limit: number;
  unit: "usd";
  resetsAt: null;
}

export interface InstantStartState {
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
  connectedProviderType: ProviderPresetType | null;
  setConnectedProviderType: (v: ProviderPresetType | null) => void;
  activeProvider: ActiveProvider;
  setActiveProvider: (v: ActiveProvider) => void;
  curveBenderPayment: CurveBenderPayment;
  setCurveBenderPayment: (v: CurveBenderPayment) => void;
  ownCurveBenderKey: boolean;
  setOwnCurveBenderKey: (v: boolean) => void;
  ownCurveBenderKeyLast4: string;
  setOwnCurveBenderKeyLast4: (v: string) => void;
  addBudgetUsage: (amount: number) => void;
  setBudgetUsed: (v: number) => void;
}

const BUDGET_LIMIT = 20.0;

const InstantStartContext = createContext<InstantStartState | null>(null);

export function useInstantStart(): InstantStartState | null {
  return useContext(InstantStartContext);
}

export function useInstantStartRequired(): InstantStartState {
  const ctx = useContext(InstantStartContext);
  if (!ctx) throw new Error("useInstantStartRequired outside provider");
  return ctx;
}

export function InstantStartProvider({ children }: { children: ReactNode }) {
  const [budgetUsed, setBudgetUsed] = useState(0);
  const [budgetExhausted, setBudgetExhausted] = useState(false);
  const [providerAdded, setProviderAdded] = useState(false);
  const [agentCreated, setAgentCreated] = useState(false);
  const [firstLanding, setFirstLanding] = useState(false);
  const [curveBenderEnabled, setCurveBenderEnabled] = useState(true);
  const [connectedProviderType, setConnectedProviderType] =
    useState<ProviderPresetType | null>(null);
  const [activeProvider, setActiveProvider] =
    useState<ActiveProvider>("curvebender");
  const [curveBenderPayment, setCurveBenderPayment] =
    useState<CurveBenderPayment>("free");
  const [ownCurveBenderKey, setOwnCurveBenderKey] = useState(false);
  const [ownCurveBenderKeyLast4, setOwnCurveBenderKeyLast4] = useState("");

  useEffect(() => {
    if (providerAdded) setCurveBenderEnabled(false);
  }, [providerAdded]);

  useEffect(() => {
    if (budgetUsed >= BUDGET_LIMIT) setBudgetExhausted(true);
  }, [budgetUsed]);

  const addBudgetUsage = (amount: number) => {
    setBudgetUsed((prev) => Math.min(prev + amount, BUDGET_LIMIT));
  };

  const freeBudget: FreeBudget = useMemo(
    () => ({
      used: budgetExhausted ? BUDGET_LIMIT : budgetUsed,
      limit: BUDGET_LIMIT,
      unit: "usd",
      resetsAt: null,
    }),
    [budgetUsed, budgetExhausted],
  );

  const state = useMemo<InstantStartState>(
    () => ({
      freeBudget,
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
      connectedProviderType,
      setConnectedProviderType,
      activeProvider,
      setActiveProvider,
      curveBenderPayment,
      setCurveBenderPayment,
      ownCurveBenderKey,
      setOwnCurveBenderKey,
      ownCurveBenderKeyLast4,
      setOwnCurveBenderKeyLast4,
      addBudgetUsage,
      setBudgetUsed,
    }),
    [
      freeBudget,
      budgetExhausted,
      providerAdded,
      agentCreated,
      firstLanding,
      curveBenderEnabled,
      connectedProviderType,
      activeProvider,
      curveBenderPayment,
      ownCurveBenderKey,
      ownCurveBenderKeyLast4,
    ],
  );

  return (
    <InstantStartContext.Provider value={state}>
      {children}
    </InstantStartContext.Provider>
  );
}
