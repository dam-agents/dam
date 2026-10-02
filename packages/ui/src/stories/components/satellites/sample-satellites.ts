/**
 * The fake backend's `satellites.list` answers `[]`, so these satellites are
 * built here, typed with the real `SatelliteView`. Agent ids line up with the
 * agent fixtures.
 */
import type { SatelliteView } from "api-server-api";

import { ago, IDS } from "../../backend/scenario";

const noArgs = { type: "object", properties: {} };

export const ONLINE_SATELLITE: SatelliteView = {
  name: "build-box",
  description: "Linux build machine in the office rack",
  host: "build-box.local",
  online: true,
  draining: false,
  lastSeenAt: ago(0),
  tools: [
    {
      name: "shell",
      description: "Run a shell command on the machine and return its output.",
      inputSchema: {
        type: "object",
        properties: { command: { type: "string" } },
      },
    },
    {
      name: "list_devices",
      title: "List attached USB devices",
      inputSchema: noArgs,
    },
  ],
  maxConcurrent: 4,
  activeJobs: 1,
  grantedAgentIds: [IDS.codingAgent],
};

export const DRAINING_SATELLITE: SatelliteView = {
  ...ONLINE_SATELLITE,
  name: "gpu-workstation",
  description: null,
  host: "gpu-01.lan",
  draining: true,
  tools: [
    {
      name: "run_benchmark",
      description: "Run the kernel benchmark suite.",
      inputSchema: noArgs,
    },
  ],
  grantedAgentIds: [],
};

export const OFFLINE_SATELLITE: SatelliteView = {
  ...ONLINE_SATELLITE,
  name: "laptop",
  description: null,
  host: null,
  online: false,
  lastSeenAt: ago(60 * 26),
  activeJobs: 0,
  grantedAgentIds: [],
};

export const NEVER_CONNECTED_SATELLITE: SatelliteView = {
  ...OFFLINE_SATELLITE,
  name: "lab-pi",
  lastSeenAt: null,
};

export const SATELLITES: readonly SatelliteView[] = [
  ONLINE_SATELLITE,
  DRAINING_SATELLITE,
  OFFLINE_SATELLITE,
  NEVER_CONNECTED_SATELLITE,
];
