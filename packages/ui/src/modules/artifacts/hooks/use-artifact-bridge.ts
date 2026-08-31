import {
  ARTIFACT_BRIDGE_ANSWER_TYPE,
  ARTIFACT_BRIDGE_FAILED_TYPE,
  ARTIFACT_BRIDGE_STATE_TYPE,
  type ArtifactBridgeReply,
  type ArtifactRequestProgress,
  type LibraryArtifact,
  type PageArtifactRequest,
} from "api-server-api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAgentRunState } from "../../agents/api/queries.js";
import { useFeatures } from "../../features/api/queries.js";
import { useCreateArtifactRequest } from "../api/mutations.js";
import { useArtifactRequest } from "../api/queries.js";
import type {
  ArtifactFrameBridge,
  ArtifactReplySender,
} from "../components/deferred-frame.js";
import {
  type ArtifactRequestFailure,
  deriveRequestProgress,
  describeFailure,
  failureFromError,
} from "../lib/artifact-request-status.js";

interface PendingRequest {
  ref: string;
  action: string;
  requestId: string | null;
}

export interface ArtifactBridgeStatus {
  action: string | null;
  progress: ArtifactRequestProgress | null;
  failure: ArtifactRequestFailure | null;
}

export interface ArtifactBridge {
  bridge: ArtifactFrameBridge | undefined;
  status: ArtifactBridgeStatus;
  dismissFailure: () => void;
}

export function useArtifactBridge(
  artifact: LibraryArtifact | null | undefined,
  openConversation: string | null = null,
): ArtifactBridge {
  const flagOn = useFeatures().data?.["interactive-artifacts"] ?? false;
  const askable = flagOn && artifact?.interactive === true;

  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [failure, setFailure] = useState<ArtifactRequestFailure | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const sendRef = useRef<ArtifactReplySender | null>(null);
  const askableIdRef = useRef<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const lastProgressRef = useRef<ArtifactRequestProgress | null>(null);

  const { mutate: createRequest } = useCreateArtifactRequest();
  const { data: row, isError: unreadable } = useArtifactRequest(
    pending?.requestId ?? null,
  );
  const agentState = useAgentRunState(artifact?.agentId ?? null);

  useEffect(() => {
    askableIdRef.current = askable && artifact ? artifact.id : null;
    conversationRef.current = openConversation;
  }, [askable, artifact, openConversation]);

  const hold = useCallback((next: PendingRequest | null) => {
    pendingRef.current = next;
    if (next === null) lastProgressRef.current = null;
    setPending(next);
  }, []);

  const send = useCallback((reply: ArtifactBridgeReply) => {
    sendRef.current?.(reply);
  }, []);

  const refuse = useCallback(
    (ref: string, next: ArtifactRequestFailure) => {
      send({
        type: ARTIFACT_BRIDGE_FAILED_TYPE,
        ref,
        reason: next.reason,
        message: next.message,
      });
      setFailure(next);
    },
    [send],
  );

  const onRequest = useCallback(
    (incoming: PageArtifactRequest) => {
      const artifactId = askableIdRef.current;
      if (!artifactId) return;
      if (pendingRef.current) {
        refuse(incoming.ref, describeFailure("busy"));
        return;
      }
      hold({ ref: incoming.ref, action: incoming.action, requestId: null });
      setFailure(null);
      lastProgressRef.current = "sent";
      send({
        type: ARTIFACT_BRIDGE_STATE_TYPE,
        ref: incoming.ref,
        state: "sent",
      });
      const conversation = conversationRef.current;
      createRequest(
        {
          artifactId,
          action: incoming.action,
          payload: incoming.payload,
          ...(conversation !== null ? { sessionId: conversation } : {}),
        },
        {
          onSuccess: (receipt) => {
            const current = pendingRef.current;
            if (current?.ref !== incoming.ref) return;
            hold({ ...current, requestId: receipt.requestId });
          },
          onError: (error) => {
            if (pendingRef.current?.ref !== incoming.ref) return;
            hold(null);
            refuse(incoming.ref, failureFromError(error));
          },
        },
      );
    },
    [createRequest, hold, refuse, send],
  );

  useEffect(() => {
    const current = pendingRef.current;
    if (!current?.requestId) return;
    if (unreadable) {
      hold(null);
      refuse(current.ref, describeFailure("wake_failed"));
      return;
    }
    if (!row || row.id !== current.requestId) return;
    if (row.state === "answered") {
      hold(null);
      send({
        type: ARTIFACT_BRIDGE_ANSWER_TYPE,
        ref: current.ref,
        result: row.result,
      });
      return;
    }
    if (row.state === "failed") {
      hold(null);
      refuse(current.ref, describeFailure(row.failureReason ?? "wake_failed"));
    }
  }, [row, unreadable, hold, refuse, send]);

  const progress = pending
    ? deriveRequestProgress(row?.state, agentState)
    : null;

  useEffect(() => {
    const current = pendingRef.current;
    if (!current || progress === null || progress === lastProgressRef.current)
      return;
    lastProgressRef.current = progress;
    send({
      type: ARTIFACT_BRIDGE_STATE_TYPE,
      ref: current.ref,
      state: progress,
    });
  }, [progress, send]);

  const onConnect = useCallback((sender: ArtifactReplySender) => {
    sendRef.current = sender;
  }, []);

  const onDisconnect = useCallback((sender: ArtifactReplySender) => {
    if (sendRef.current === sender) sendRef.current = null;
  }, []);

  const bridge = useMemo(
    () => (askable ? { onConnect, onDisconnect, onRequest } : undefined),
    [askable, onConnect, onDisconnect, onRequest],
  );

  const dismissFailure = useCallback(() => setFailure(null), []);

  return {
    bridge,
    status: { action: pending?.action ?? null, progress, failure },
    dismissFailure,
  };
}
