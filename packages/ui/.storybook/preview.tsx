import "../src/stories/backend/boot";
import "../src/App.css";

import type { Preview } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import { initAuth } from "../src/auth";
import { applyBrand, loadBrand } from "../src/brand";
import { queryClient } from "../src/query-client";

let booted: Promise<unknown> | undefined;

/** The same boot steps as src/main.tsx, minus the terms gate. */
const boot = () =>
  (booted ??= Promise.all([initAuth(), loadBrand().then(applyBrand)]));

const preview: Preview = {
  parameters: { layout: "fullscreen" },
  loaders: [
    async () => {
      await boot();
      return {};
    },
  ],
  decorators: [
    (Story) => (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={200}>
          <Story />
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    ),
  ],
};

export default preview;
