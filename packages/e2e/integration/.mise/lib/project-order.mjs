import assert from "node:assert/strict";

// TEST_OVERVIEW: full scenarios share the smoke suite's user, agents and controller. They run without overlapping shared mutations. Machine restart scenarios belong only to the final machine project, after the other scenarios finish.
process.env.E2E_FULL = "1";
process.env.E2E_SCOPE = "";
const { default: config } = await import("../../playwright.config.ts");
const projects = config.projects ?? [];
const byName = new Map(
  projects.map((project) => {
    assert.ok(project.name, "every project has a name");
    return [project.name, project];
  }),
);
const full = [...byName.keys()].filter((name) => name.endsWith("-full"));
const smoke = [...byName.keys()].filter(
  (name) =>
    !name.endsWith("-full") &&
    name !== "agent-machine" &&
    name !== "runner-release",
);
assert.ok(full.length > 0, "the full suite must contain full projects");

function ancestors(name) {
  const found = new Set();
  const pending = [...(byName.get(name)?.dependencies ?? [])];
  while (pending.length) {
    const next = pending.pop();
    assert.ok(
      byName.has(next),
      `${name} depends on an unknown project ${next}`,
    );
    if (found.has(next)) continue;
    found.add(next);
    pending.push(...(byName.get(next)?.dependencies ?? []));
  }
  return found;
}

for (const name of full) {
  const before = ancestors(name);
  assert.ok(!before.has(name), `${name} depends on itself`);
  for (const setup of smoke) {
    assert.ok(before.has(setup), `${name} may run before ${setup} finishes`);
  }
  assert.equal(
    byName.get(name)?.workers,
    1,
    `${name} shares fixtures across its files`,
  );
  for (const other of full) {
    if (other === name) continue;
    assert.ok(
      before.has(other) || ancestors(other).has(name),
      `${name} may overlap ${other}`,
    );
  }
}
const machineSpec = "/src/tests/smoke/19-agent-machine.spec.ts";
const machineProjects = projects
  .filter((project) =>
    [project.testMatch]
      .flat()
      .some((match) => match instanceof RegExp && match.test(machineSpec)),
  )
  .map((project) => project.name);
assert.deepEqual(
  machineProjects,
  ["agent-machine"],
  "machine restart scenarios must run once, after shared fixtures are finished",
);
const beforeMachines = ancestors("agent-machine");
for (const name of [...smoke, ...full]) {
  assert.ok(beforeMachines.has(name), `machine restarts may overlap ${name}`);
}
assert.ok(
  ancestors("runner-release").has("agent-machine"),
  "runner releases must wait for machine restart scenarios",
);
console.log(
  "Full projects run without overlapping shared fixtures; machine restarts run once, after those fixtures finish.",
);
