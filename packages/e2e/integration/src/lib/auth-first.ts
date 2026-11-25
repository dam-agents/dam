import assert from "node:assert/strict";

interface ProjectOrder {
  name: string;
  dependencies?: string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the projects that can start before the auth project ends.
 * The auth project's first test proves the Terms gate, so the shared account must not
 * have accepted the Terms yet; every other project's specs accept them. A project
 * that does not reach auth through its dependencies runs beside it in another worker,
 * and the gate test then reads 200 where it expects 412 (#6579).
 */
export function projectsBeforeAuth(projects: ProjectOrder[]): string[] {
  const byName = new Map(projects.map((project) => [project.name, project]));
  const reachesAuth = (name: string, seen: Set<string>): boolean => {
    if (name === "auth") return true;
    if (seen.has(name)) return false;
    seen.add(name);
    const deps = byName.get(name)?.dependencies ?? [];
    return deps.some((dep) => reachesAuth(dep, seen));
  };
  return projects
    .filter(({ name }) => name !== "auth" && !reachesAuth(name, new Set()))
    .map(({ name }) => name);
}

if (import.meta.main) {
  assert.deepEqual(
    projectsBeforeAuth([
      { name: "auth" },
      { name: "direct", dependencies: ["auth"] },
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
    assert.ok(projects.some(({ name }) => name === "auth"));
    assert.deepEqual(
      projectsBeforeAuth(projects),
      [],
      `E2E_FULL="${tier}": these projects can start before auth`,
    );
  }
  console.log("auth-first self-check OK");
}
