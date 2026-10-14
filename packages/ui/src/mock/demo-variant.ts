import { create } from "zustand";

export type DemoVariant = 1 | 2 | 3 | 4 | 5;

export const DEMO_VARIANT_LABELS: Record<DemoVariant, string> = {
  1: "Frosted bar",
  2: "Floating island",
  3: "Slim ribbon",
  4: "Dark dock",
  5: "Corner card",
};

interface DemoVariantState {
  variant: DemoVariant;
  setVariant: (v: DemoVariant) => void;
  next: () => void;
}

export const useDemoVariant = create<DemoVariantState>((set) => ({
  variant: 1,
  setVariant: (variant) => set({ variant }),
  next: () => set((s) => ({ variant: ((s.variant % 5) + 1) as DemoVariant })),
}));
