import {
  type ProviderOutage,
  type ProviderStatusView,
  providerTypeForTemplateId,
} from "api-server-api";

import { providerNameFor } from "./provider-name.js";

export interface StatusLink {
  name: string;
  url: string;
}

export interface OutageHide {
  key: string;
  since: string;
}

export interface BannerState {
  damSide: boolean;
  since: string;
  names: string[];
  statusLinks: StatusLink[];
  hides: OutageHide[];
}

const HIDE_KEY_PREFIX = "provider-outage-hidden";

const hideOf = (subject: string, since: string): OutageHide => ({
  key: `${HIDE_KEY_PREFIX}:${subject}`,
  since,
});

function earliest(times: readonly string[]): string {
  return [...times].sort()[0] ?? "";
}

function outagesState(outages: readonly ProviderOutage[]): BannerState {
  const names = [
    ...new Set(
      outages.map((o) => providerNameFor(o.templateId) ?? o.templateId),
    ),
  ];
  const links = new Map<string, string>();
  for (const o of outages)
    if (o.statusPageUrl && !links.has(o.statusPageUrl))
      links.set(o.statusPageUrl, providerNameFor(o.templateId) ?? o.templateId);
  return {
    damSide: false,
    since: earliest(outages.map((o) => o.since)),
    names,
    statusLinks: [...links].map(([url, name]) => ({ name, url })),
    hides: outages.map((o) => hideOf(o.templateId, o.since)),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the outage banner shows to one user: the
 * outages of the templates that the user has a Connection to, or the fault
 * on the platform's side when the user has any provider Connection. Closing
 * the banner hides each shown outage by its template and start time, so a
 * new outage, or a new start, shows again. The browser keeps one start time
 * per template, so closed outages do not pile up.
 */
export function bannerState(
  view: ProviderStatusView,
  templateIds: ReadonlySet<string>,
  isHidden: (hide: OutageHide) => boolean,
): BannerState | null {
  if (view.damSide) {
    const hasProvider = [...templateIds].some(
      (t) => providerTypeForTemplateId(t) !== null,
    );
    const hide = hideOf("dam-side", view.damSide.since);
    if (!hasProvider || isHidden(hide)) return null;
    return {
      damSide: true,
      since: view.damSide.since,
      names: [],
      statusLinks: [],
      hides: [hide],
    };
  }
  const shown = view.outages.filter(
    (o) =>
      templateIds.has(o.templateId) && !isHidden(hideOf(o.templateId, o.since)),
  );
  return shown.length > 0 ? outagesState(shown) : null;
}
