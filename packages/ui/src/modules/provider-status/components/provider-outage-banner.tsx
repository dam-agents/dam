import {
  type CarbonIconType,
  Close,
  ErrorFilled,
  Launch,
  Warning,
} from "@carbon/icons-react";
import { useState, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { cn } from "@/lib/utils";

import {
  getApiHealthSnapshot,
  subscribeApiHealth,
} from "../../../lib/api-health.js";
import {
  readPersistedFlag,
  writePersistedFlag,
} from "../../../lib/persisted-prefs.js";
import { useStore } from "../../../store.js";
import { useAppConnections } from "../../connections/api/queries.js";
import { useProviderStatus } from "../api/queries.js";
import { bannerState } from "../lib/banner-state.js";
import { type BannerCopy, bannerCopy } from "../lib/copy.js";

const HIDE_LABEL = "Hide until the status changes";

const TONE_ICON: Record<BannerCopy["tone"], CarbonIconType> = {
  warning: Warning,
  danger: ErrorFilled,
};

const TONE_TEXT: Record<BannerCopy["tone"], string> = {
  warning: "text-warning-fg",
  danger: "text-danger",
};

export function ProviderOutageBanner({ className }: { className?: string }) {
  const apiHealth = useSyncExternalStore(
    subscribeApiHealth,
    getApiHealthSnapshot,
  );
  const { data: status } = useProviderStatus();
  const { data: connections } = useAppConnections();
  const navigateToSettings = useStore((s) => s.navigateToSettings);
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  if (apiHealth !== "connected" || !status || !connections) return null;

  const state = bannerState(
    status,
    new Set(connections.map((c) => c.templateId)),
    (key) => closed.has(key) || readPersistedFlag(key, false),
  );
  if (!state) return null;
  const { hideKeys } = state;
  const { tone, lead, body } = bannerCopy(state);
  const Icon = TONE_ICON[tone];

  function handleClose() {
    for (const key of hideKeys) writePersistedFlag(key, true);
    setClosed((prev) => new Set([...prev, ...hideKeys]));
  }

  return (
    <Callout
      tone={tone}
      size="sm"
      role="status"
      data-testid="provider-outage-banner"
      className={cn("flex items-start gap-2.5 text-sm", className)}
    >
      <Icon size={16} className={cn("mt-0.5 shrink-0", TONE_TEXT[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <strong className={cn("font-semibold", TONE_TEXT[tone])}>{lead}</strong>
        <span className="hidden text-pretty text-muted-foreground sm:inline">
          {body}
        </span>
      </div>
      {!state.damSide && (
        <div className="hidden shrink-0 items-center gap-3 sm:flex">
          {state.statusLinks.map((link) => (
            <Button key={link.url} asChild variant="link" size="inline">
              <a href={link.url} target="_blank" rel="noreferrer">
                {link.name} status
                <Launch size={14} />
              </a>
            </Button>
          ))}
          <Button
            variant="link"
            size="inline"
            onClick={() => navigateToSettings("providers")}
          >
            View providers
          </Button>
        </div>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={HIDE_LABEL}
        tooltip={HIDE_LABEL}
        onClick={handleClose}
        className="shrink-0 text-muted-foreground"
      >
        <Close size={16} />
      </Button>
    </Callout>
  );
}
