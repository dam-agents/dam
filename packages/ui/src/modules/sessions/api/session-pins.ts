import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  AttentionItem,
  SessionPin,
  SessionPinKey,
  SessionPinList,
} from "api-server-api";
import { useEffect, useMemo } from "react";

import { api } from "../../../api.js";
import { queryClient } from "../../../query-client.js";
import { trpc } from "../../../trpc.js";
import { useAttention } from "../../home/api/queries.js";
import { activitySessionKey } from "../../home/lib/activity-sessions.js";

const NO_PINS: readonly SessionPin[] = Object.freeze([]);
const pinsKey = () => trpc.sessionPins.list.queryKey();
const SCOPE = { id: "session-pins" };

export function useSessionPins(): {
  pins: readonly SessionPin[];
  pinnedKeys: ReadonlySet<string>;
} {
  const { data } = useQuery({
    ...trpc.sessionPins.list.queryOptions(),
    staleTime: 30_000,
    meta: { errorToast: "Couldn't load your pinned sessions" },
  });
  const attentionUpdatedAt = useAttention().dataUpdatedAt;
  useEffect(() => {
    if (attentionUpdatedAt > 0) refetchSessionPins();
  }, [attentionUpdatedAt]);
  const pins = data?.pins ?? NO_PINS;
  const pinnedKeys = useMemo(
    () =>
      new Set(
        pins.map((pin) => activitySessionKey(pin.agentId, pin.sessionId)),
      ),
    [pins],
  );
  return { pins, pinnedKeys };
}

export function refetchSessionPins(): void {
  void queryClient.invalidateQueries({ queryKey: pinsKey() });
}

async function patchPins(patch: (pins: SessionPin[]) => SessionPin[]) {
  await queryClient.cancelQueries({ queryKey: pinsKey() });
  queryClient.setQueryData(
    pinsKey(),
    (list: SessionPinList | undefined): SessionPinList => ({
      pins: patch([...(list?.pins ?? [])]),
    }),
  );
}

const samePin = (a: SessionPinKey, b: SessionPinKey) =>
  a.agentId === b.agentId && a.sessionId === b.sessionId;

export function forgetSessionPin(key: SessionPinKey): void {
  const cached = queryClient.getQueryData<SessionPinList>(pinsKey());
  if (!cached?.pins.some((pin) => samePin(pin, key))) return;
  void patchPins((pins) => pins.filter((p) => !samePin(p, key)));
  api.sessionPins.unpin.mutate(key).catch(refetchSessionPins);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: pinning and unpinning a sidebar Session. Each
 * shows at once: a pin joins the Pinned section with the attention row the
 * list already holds, an unpin leaves it, and a refused change is undone by
 * reading the pins again. Neither touches the Agent, so a sleeping Agent
 * stays asleep.
 */
export function useSessionPinActions(): {
  pin: (key: SessionPinKey, item: AttentionItem | null) => void;
  unpin: (key: SessionPinKey) => void;
} {
  const pin = useMutation(
    trpc.sessionPins.pin.mutationOptions({
      scope: SCOPE,
      onError: refetchSessionPins,
      onSettled: refetchSessionPins,
      meta: { errorToast: "Couldn't pin the session" },
    }),
  );
  const unpin = useMutation(
    trpc.sessionPins.unpin.mutationOptions({
      scope: SCOPE,
      onMutate: (key) =>
        patchPins((pins) => pins.filter((p) => !samePin(p, key))),
      onError: refetchSessionPins,
      meta: { errorToast: "Couldn't unpin the session" },
    }),
  );
  return {
    pin: (key, item) => {
      void patchPins((pins) =>
        pins.some((p) => samePin(p, key))
          ? pins
          : [{ ...key, pinnedAt: new Date().toISOString(), item }, ...pins],
      );
      pin.mutate(key);
    },
    unpin: (key) => unpin.mutate(key),
  };
}
