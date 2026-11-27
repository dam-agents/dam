import type { Person } from "./people.js";
import type { World } from "./world.js";

/** UNIT_BOUNDARY_DESCRIPTION: the name an agent calls a satellite's tool by: the satellite's name with every character but a lower-case letter or digit made `_`, then `__` and the tool. */
export function scopedTool(satellite: string, tool: string): string {
  return `${satellite.replace(/[^a-z0-9]/g, "_")}__${tool}`;
}

/** UNIT_BOUNDARY_DESCRIPTION: a machine of the person's that connects a satellite, as its worker does with the person's credential; the satellite is removed when the example ends. */
export async function connectMachine(
  world: World,
  person: Person,
  name: string,
  host: string,
  tools: string[],
): Promise<void> {
  await person.api.satellites.connect.mutate({
    manifest: {
      name: world.unique(name),
      tools: tools.map((tool) => ({
        name: tool,
        inputSchema: { type: "object" as const },
      })),
    },
    host,
  });
  world.undo.push(() =>
    person.api.satellites.remove.mutate(world.unique(name)).catch(() => {}),
  );
  world.note({ step: "satellite connected", name, host, tools });
}
