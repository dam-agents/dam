import type { HarnessCapability } from "agent-runtime-api";
import type { RuntimeManifest } from "../manifest.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: what a harness's own manifest says about it in
 * hello, so the api-server can offer a harness that the install's harness
 * catalog does not list: the model APIs it speaks through the Model Router,
 * and the title its ACP agent gives itself. A harness that is not routed
 * reports no dialects.
 */
export function harnessFacts(
  manifest: RuntimeManifest | undefined,
): Pick<HarnessCapability, "dialects" | "title"> {
  const title = manifest?.initializeCapabilities?.agentInfo?.title;
  return {
    ...(manifest?.modelRouter && {
      dialects: [...manifest.modelRouter.dialects],
    }),
    ...(title && { title }),
  };
}
