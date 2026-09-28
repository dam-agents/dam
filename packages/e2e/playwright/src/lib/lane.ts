export type Backend = "container" | "vm";

// UNIT_BOUNDARY_DESCRIPTION: the Backend this run's agents land on. CI runs the smoke suite twice, as two lanes: the container lane on a plain install, and the vm lane on an install with virtualization enabled, which it asks for with E2E_VIRTUALIZATION — the same variable e2e:install reads to turn the vm backend on. In the vm lane every agent a spec creates is a vm Agent: the UI's because global setup opts the e2e user into the vm-sandboxes experiment, the API's because the spec helpers ask for vm. The Playwright config reads it too, to order and select the specs that only one lane runs. It has no dependencies, so the config can import it.
export const laneBackend: Backend = process.env.E2E_VIRTUALIZATION
  ? "vm"
  : "container";
