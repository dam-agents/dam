import { agentEntries } from "./fixtures/agents";
import { chatEntries } from "./fixtures/chat";
import { connectionsEntries } from "./fixtures/connections";
import { kitsEntries } from "./fixtures/kits";
import { sandboxEntries } from "./fixtures/sandbox";
import { settingsEntries } from "./fixtures/settings";
import { shellEntries } from "./fixtures/shell";
import { type Fixtures, mergeFixtures } from "./trpc-server";

export function platformFixtures(): Fixtures {
  return mergeFixtures(
    agentEntries,
    shellEntries,
    chatEntries,
    connectionsEntries,
    sandboxEntries,
    kitsEntries,
    settingsEntries,
  );
}
