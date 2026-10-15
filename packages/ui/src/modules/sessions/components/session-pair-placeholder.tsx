import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

import { useStore } from "../../../store.js";
import {
  useHarnessCatalog,
  useProviderConnections,
  useRememberedPair,
} from "../api/session-pair.js";
import {
  fittingProviders,
  nextPair,
  pairLabel,
} from "../lib/session-pair-options.js";
import { ConnectProvidersPrompt } from "./session-pair-picker.js";
import { SessionPairTrigger } from "./session-pair-trigger.js";

interface Props {
  agentId: string;
  agentHarness: string | undefined;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onConnectProviders: () => void;
}

export function SessionPairPlaceholder({
  agentId,
  agentHarness,
  open,
  onOpenChange,
  onConnectProviders,
}: Props) {
  const { data: catalog } = useHarnessCatalog();
  const { data: remembered } = useRememberedPair(agentId);
  const chosen = useStore((s) => s.nextSessionPair[agentId] ?? null);
  const providers = useProviderConnections(agentId);
  const views = catalog?.harnesses ?? [];
  const harness = agentHarness ?? catalog?.default;
  const pair =
    harness &&
    (nextPair(
      chosen,
      remembered?.harness === harness
        ? remembered
        : { harness, provider: null, model: null },
      [harness],
      fittingProviders(views, providers.granted),
    ) ?? { harness, provider: null, model: null });
  const label = pair
    ? pairLabel(pair, catalog?.harnesses, providers.granted)
    : undefined;

  if (providers.loaded && providers.granted.length === 0)
    return <ConnectProvidersPrompt onClick={onConnectProviders} />;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <SessionPairTrigger label={label} aria-busy />
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        aria-label="New session harness and model"
        className="w-[340px] p-3 text-sm"
      >
        <span
          role="status"
          className="inline-flex items-center gap-1.5 text-muted-foreground"
        >
          <Spinner size={12} className="text-muted-foreground" />
          Loading models…
        </span>
      </PopoverContent>
    </Popover>
  );
}
