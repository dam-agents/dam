import { Add } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { AgentView } from "../../../../types.js";
import { SharedChannelsNotice } from "../../../connections/components/shared-channels-notice.js";
import { useDismissibleConfirm } from "../../../connections/hooks/use-dismissible-confirm.js";
import {
  type SharedChannel,
  sharedChannelsTitle,
} from "../../../sandboxes/lib/shared-channels.js";
import { useActiveScheduleCounts } from "../../hooks/use-active-schedule-counts.js";
import { useAgentConnectionNames } from "../../hooks/use-agent-connection-names.js";
import { useInlineAgentCreate } from "../../hooks/use-inline-agent-create.js";
import { CreateAgentInline } from "../create-agent-inline.js";
import { type BindMessenger, BindPage } from "./bind-page.js";
import { BindSharingText } from "./bind-sharing-text.js";
import { PickerFooter } from "./picker-footer.js";
import { PickerSearch } from "./picker-search.js";
import { PickerSectionList } from "./picker-section-list.js";
import { pickerSections } from "./picker-sections.js";

const BIND_CONFIRM_STORAGE_KEY =
  "platform-bind-shared-connections-confirm-dismissed";

export interface BindPickerCopy {
  messenger: BindMessenger;
  title: string;
  subtitle: string;
  emptySubtitle: string;
  consent: string;
  action: string;
  audience: SharedChannel | null;
}

interface Props {
  copy: BindPickerCopy;
  error: { title: string; hint: string } | null;
  pending: boolean;
  onPick: (agent: AgentView) => void;
  onAgentCreated: () => void;
}

export function AgentBindPicker({
  copy,
  error,
  pending,
  onPick,
  onAgentCreated,
}: Props) {
  const {
    isLoading,
    displayedAgents,
    justCreatedId,
    creating,
    openCreateForm,
    markCreated,
  } = useInlineAgentCreate();
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState<string | null>(null);
  const scheduleCounts = useActiveScheduleCounts();

  const sections = useMemo(
    () => pickerSections(displayedAgents, query),
    [displayedAgents, query],
  );
  const selectedId = pickedId ?? justCreatedId;
  const selected = displayedAgents.find((a) => a.id === selectedId) ?? null;
  const connectionNames = useAgentConnectionNames(selected);
  const bindConfirm = useDismissibleConfirm(BIND_CONFIRM_STORAGE_KEY);
  const sharing =
    selected && copy.audience && connectionNames.length > 0 ? (
      <BindSharingText
        agentName={selected.name}
        connectionNames={connectionNames}
        audience={copy.audience}
      />
    ) : null;

  const confirmPick = async () => {
    if (!selected) return;
    if (
      sharing &&
      copy.audience &&
      !(await bindConfirm.confirm({
        title: `Share ${selected.name}'s connections with ${sharedChannelsTitle([copy.audience])}?`,
        body: sharing,
        confirmLabel: copy.action,
      }))
    )
      return;
    onPick(selected);
  };

  const handleCreated = (agent: AgentView) => {
    markCreated(agent);
    setPickedId(agent.id);
    onAgentCreated();
  };

  if (isLoading) {
    return (
      <BindPage
        messenger={copy.messenger}
        title={copy.title}
        subtitle={copy.subtitle}
      >
        <div className="mt-6">
          <ListSkeleton rows={3} rowHeight={100} />
        </div>
      </BindPage>
    );
  }

  if (displayedAgents.length === 0) {
    return (
      <BindPage
        messenger={copy.messenger}
        title={copy.title}
        subtitle={copy.emptySubtitle}
      >
        <PickerError error={error} />
        <div className="mt-6">
          <CreateAgentInline onCreated={handleCreated} />
        </div>
      </BindPage>
    );
  }

  return (
    <BindPage
      messenger={copy.messenger}
      title={copy.title}
      subtitle={copy.subtitle}
      footer={
        <PickerFooter
          consent={copy.consent}
          notice={
            bindConfirm.dismissed &&
            sharing && (
              <SharedChannelsNotice className="mb-4">
                {sharing}
              </SharedChannelsNotice>
            )
          }
          action={copy.action}
          enabled={selected !== null}
          pending={pending}
          onConfirm={() => void confirmPick()}
        />
      }
    >
      <PickerSearch value={query} onChange={setQuery} />
      <PickerError error={error} />
      {sections.length === 0 ? (
        <p className="mt-6 text-sm text-muted-foreground">
          No agents match “{query.trim()}”.
        </p>
      ) : (
        <PickerSectionList
          sections={sections}
          selectedId={selected?.id ?? null}
          scheduleCounts={scheduleCounts}
          onSelect={(agent) => setPickedId(agent.id)}
        />
      )}
      {creating ? (
        <div className="mt-6">
          <CreateAgentInline onCreated={handleCreated} />
        </div>
      ) : (
        <Button
          variant="link"
          size="inline"
          onClick={openCreateForm}
          tone="muted"
          className="mt-6 text-sm"
        >
          <Add size={16} /> Create a new agent
        </Button>
      )}
    </BindPage>
  );
}

function PickerError({ error }: { error: Props["error"] }) {
  if (!error) return null;
  return (
    <p className="mt-4 text-sm text-danger">
      {error.title} — {error.hint}
    </p>
  );
}
