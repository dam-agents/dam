import assert from "node:assert/strict";

interface ProjectOrder {
  name: string;
  dependencies?: string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the projects that can start before the setup project ends.
 * The setup project makes the shared state every spec runs on: the shared account's
 * login and Terms, its assistant switched off, the suite's connection, provider and mock
 * agent. A project that does not reach setup through its dependencies runs beside it and
 * reads state that is not there yet.
 */
export function projectsBeforeSetup(projects: ProjectOrder[]): string[] {
  const byName = new Map(projects.map((project) => [project.name, project]));
  const reachesSetup = (name: string, seen: Set<string>): boolean => {
    if (name === "setup") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const deps = byName.get(name)?.dependencies ?? [];
    return deps.some((dep) => reachesSetup(dep, seen));
  };
  return projects
    .filter(({ name }) => name !== "setup" && !reachesSetup(name, new Set()))
    .map(({ name }) => name);
}

if (import.meta.main) {
  assert.deepEqual(
    projectsBeforeSetup([
      { name: "setup" },
      { name: "direct", dependencies: ["setup"] },
      { name: "through", dependencies: ["direct"] },
      { name: "free" },
      { name: "loop", dependencies: ["loop"] },
    ]),
    ["free", "loop"],
  );

  for (const tier of ["", "1"]) {
    process.env.E2E_FULL = tier;
    const { default: config } = await import(
      `../../playwright.config.ts?full=${tier}`
    );
    const projects = (config.projects ?? []) as ProjectOrder[];
    assert.ok(projects.some(({ name }) => name === "setup"));
    assert.deepEqual(
      projectsBeforeSetup(projects),
      [],
      `E2E_FULL="${tier}": these projects can start before setup`,
    );
  }
  console.log("setup-first self-check OK");
}
