import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";

import {
  useHarnessCatalog,
  useProviderConnections,
  useRememberedPair,
} from "../api/session-pair.js";
import { fittingProviders, nextPair } from "../lib/session-pair-options.js";
import { ConnectProvidersPrompt } from "./session-pair-picker.js";

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
  const providers = useProviderConnections(agentId);
  const views = catalog?.harnesses ?? [];
  const harness = agentHarness ?? catalog?.default;
  const pair =
    harness &&
    (nextPair(
      null,
      remembered?.harness === harness
        ? remembered
        : { harness, provider: null, model: null },
      [harness],
      fittingProviders(views, providers.granted),
    ) ?? { harness, provider: null, model: null });
  const label =
    pair &&
    [
      pair.model,
      views.find((h) => h.name === pair.harness)?.displayName ?? pair.harness,
      providers.granted.find((p) => p.id === pair.provider)?.name,
    ]
      .filter(Boolean)
      .join(" · ");

  if (providers.loaded && providers.owned.length === 0)
    return <ConnectProvidersPrompt onClick={onConnectProviders} />;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="session-pair-picker"
          aria-busy="true"
          aria-label={label ? undefined : "Loading harness and model"}
          className="flex items-center gap-1 pl-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {label || <Spinner size={12} />}
        </button>
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
