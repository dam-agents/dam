import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import { useInstantStart } from "../context.js";
import { Approach2Modal } from "./approach-2-modal.js";
import { InstantStartDebugControls } from "./debug-controls.js";
import { GettingStartedChecklist } from "./getting-started-checklist.js";

export function InstantStartGate({ children }: { children: ReactNode }) {
  const ctx = useInstantStart();

  if (!ctx) return <>{children}</>;

  return (
    <>
      {ctx.approach === 1 && <Approach1Boot />}
      {ctx.approach === 2 && <Approach2Boot />}
      {ctx.approach === 3 && <Approach3Boot />}
      {children}
      {ctx.firstLanding && <GettingStartedChecklist />}
      <InstantStartDebugControls />
    </>
  );
}

function Approach1Boot() {
  const createAgent = useCreateAgent();
  const createdRef = useRef(false);
  const selectAgent = useStore((s) => s.selectAgent);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    createAgent
      .mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      })
      .then((agent) => {
        selectAgent(agent.id);
      })
      .catch(() => {});
  }, []);

  return null;
}

function Approach2Boot() {
  const ctx = useInstantStart()!;
  const [modalOpen, setModalOpen] = useState(true);

  const handleClose = () => {
    setModalOpen(false);
    ctx.setAgentCreated(true);
  };

  if (!modalOpen) return null;

  return <Approach2Modal onClose={handleClose} />;
}

function Approach3Boot() {
  const createAgent = useCreateAgent();
  const createdRef = useRef(false);
  const selectAgent = useStore((s) => s.selectAgent);

  useEffect(() => {
    if (createdRef.current) return;
    createdRef.current = true;
    createAgent
      .mutateAsync({
        name: "agent",
        templateId: "claude-code",
        egressPreset: "trusted",
      })
      .then((agent) => {
        selectAgent(agent.id);
      })
      .catch(() => {});
  }, []);

  return null;
}
