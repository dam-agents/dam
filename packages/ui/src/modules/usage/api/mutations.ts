import { useMutation } from "@tanstack/react-query";

import { trpc } from "../../../trpc.js";

export function useRecordEntryPoint() {
  return useMutation({
    ...trpc.usage.entryPointChosen.mutationOptions(),
    meta: { suppressErrorToast: true },
  });
}
