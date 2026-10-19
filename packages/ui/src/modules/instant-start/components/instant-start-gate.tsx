import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useInstantStart } from "../context.js";
import { Approach2Modal } from "./approach-2-modal.js";
import { CreatingAgentOverlay } from "./creating-agent-overlay.js";
import { InstantStartDebugControls } from "./debug-controls.js";

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      {ctx.approach === 1 && <Approach1Boot />}
      {ctx.approach === 2 && <Approach2Boot />}
      {ctx.approach === 3 && <Approach3Boot />}
      {children}
      <InstantStartDebugControls />
    </>
  );
}

function Approach1Boot() {
  const ctx = useInstantStart()!;
  const createAgent = useCreateAgent();
  const createdRef = useRef(false);
  const selectAgent = useStore((s) => s.selectAgent);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    ctx.setAgentCreated(false);
    createAgent
      .mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      })
      .then((agent) => {
        selectAgent(agent.id);
        ctx.setAgentCreated(true);
      })
      .catch(() => {
        ctx.setAgentCreated(true);
      });
  }, []);

  return <CreatingAgentOverlay visible={!ctx.agentCreated} />;
}

function Approach2Boot() {
  const ctx = useInstantStart()!;
  const [modalOpen, setModalOpen] = useState(true);
  const selectedAgent = useStore((s) => s.selectedAgent);

  useEffect(() => {
    if (selectedAgent) {
      setModalOpen(false);
      ctx.setAgentCreated(true);
    }
  }, [selectedAgent]);

  if (!modalOpen) return null;

  return <Approach2Modal onClose={() => setModalOpen(false)} />;
}

function Approach3Boot() {
  const ctx = useInstantStart()!;
  const createAgent = useCreateAgent();
  const createdRef = useRef(false);
  const selectAgent = useStore((s) => s.selectAgent);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    ctx.setAgentCreated(false);
    createAgent
      .mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      })
      .then((agent) => {
        selectAgent(agent.id);
        ctx.setAgentCreated(true);
      })
      .catch(() => {
        ctx.setAgentCreated(true);
      });
  }, []);

  return <CreatingAgentOverlay visible={!ctx.agentCreated} />;
}
