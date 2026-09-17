import { parseStarterKitRef } from "../../agents/utils/agent-kind.js";
import { useFeatures } from "../../features/api/queries.js";
import { useStarterKits } from "../api/queries.js";

export function useKitName(
  starterKit: string | null,
  enabled: boolean,
): string {
  const kitsEnabled = useFeatures().data?.["starter-kits"] ?? false;
  const kits = useStarterKits(kitsEnabled && enabled);
  const ref = starterKit ? parseStarterKitRef(starterKit) : null;
  const kit = ref
    ? kits.data?.find((k) => k.catalog === ref.catalog && k.id === ref.kit)
    : undefined;
  return kit?.name ?? ref?.kit ?? "Starter kit";
}
