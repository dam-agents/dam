import type { Links } from "api-server-api";

import { isExternalHttpUrl } from "../../../lib/external-link.js";
import {
  type DocsPage,
  docsPageUrl,
} from "../../../modules/links/lib/docs-pages.js";

export const CHART_DEFAULT_LINKS: Links = {
  docs: "https://pages.github.ibm.com/dam-agents/docs/",
  computeRequest:
    "https://ibm-research.slack.com/archives/C0B3F03NB24/p1788879773235759",
  curveBenderCommunity: "https://ibm.enterprise.slack.com/archives/C0C3E4VJAR1",
  slackInstallRequest: null,
};

export const fakeLinks: { current: Links } = {
  current: { ...CHART_DEFAULT_LINKS },
};

function external(name: keyof Links): string | null {
  const href = fakeLinks.current[name];
  return href && isExternalHttpUrl(href) ? href : null;
}

export const useLinks = () => ({ data: fakeLinks.current });
export const useSlackInstallRequestUrl = () => external("slackInstallRequest");
export const useComputeRequestUrl = () => external("computeRequest");
export const useCurveBenderCommunityUrl = () =>
  external("curveBenderCommunity");
export const useDocsUrl = (page: DocsPage) => {
  const root = external("docs");
  return root && docsPageUrl(root, page);
};
