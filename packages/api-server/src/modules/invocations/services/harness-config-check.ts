import type { InvocationRow } from "../infrastructure/invocations-repository.js";
import {
  harnessConfigRefusal,
  type ReadHarnessConfigSupport,
} from "../domain/harness-config-refusal.js";

export async function harnessConfigRefusalFor(
  row: Pick<InvocationRow, "id" | "harnessConfig">,
  readSupport: ReadHarnessConfigSupport,
): Promise<string | null> {
  if (row.harnessConfig === null) return null;
  return harnessConfigRefusal(row.harnessConfig, await readSupport(row.id));
}
