/**
 * Shared loaders for the artifact component stories. Every value comes from
 * the fake backend (`stories/backend/fixtures/sandbox.ts`) through the real
 * tRPC client — nothing here invents domain data.
 */
import type {
  ArtifactFolder,
  ArtifactVersionInfo,
  LibraryArtifact,
} from "api-server-api";

import { api } from "@/api";
import { queryClient } from "@/query-client";

import { type Scenario, setScenario } from "../../backend/scenario";

/** Fixture artifact ids, one per notable state. */
export const ART = {
  /** HTML, public, 3 versions, 23 views, in "Reports". */
  html: "art-latency-report",
  /** Binary SVG image, private. */
  image: "art-latency-chart",
  /** Markdown, restricted to two viewers, 2 versions. */
  restricted: "art-refund-design",
  /** TypeScript code, private, ungrouped. */
  code: "art-refund-patch",
  /** Markdown, public, scheduled for deletion in 28 days. */
  expiring: "art-help-digest",
  /** JSX, private. */
  jsx: "art-revenue-region",
  /** CSV text, 5 versions. */
  csv: "art-open-tickets",
} as const;

/**
 * Sets the fake backend's scenario from `parameters.scenario` and drops
 * cached queries. List it first in `loaders` so it runs before any fetch.
 */
export const scenarioLoader = ({
  parameters,
}: {
  parameters: { scenario?: Scenario };
}) => {
  setScenario(parameters.scenario ?? "populated");
  queryClient.clear();
  return {};
};

/** Put in `beforeEach`: restores the default scenario when the story is left,
 *  so "empty" doesn't leak into stories that never set one. */
export const restoreScenario = () => () => {
  setScenario("populated");
  queryClient.clear();
};

export const getArtifact = (id: string): Promise<LibraryArtifact> =>
  api.artifactLibrary.get.query({ id });

export const listArtifacts = (): Promise<LibraryArtifact[]> =>
  api.artifactLibrary.list.query({});

export const listFolders = (): Promise<ArtifactFolder[]> =>
  api.artifactLibrary.listFolders.query();

export const listVersions = (id: string): Promise<ArtifactVersionInfo[]> =>
  api.artifactLibrary.listVersions.query({ id });
