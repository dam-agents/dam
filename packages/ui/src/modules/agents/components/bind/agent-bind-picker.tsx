import { AddAlt } from "@carbon/icons-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

import { ListSkeleton } from "../../../../components/list-skeleton.js";
import type { AgentView } from "../../../../types.js";
import { SharedChannelsNotice } from "../../../connections/components/shared-channels-notice.js";
import type { SharedChannel } from "../../../sandboxes/lib/shared-channels.js";
import { useActiveScheduleCounts } from "../../hooks/use-active-schedule-counts.js";
import { useBindSharingConfirm } from "../../hooks/use-bind-sharing-confirm.js";
import { useInlineAgentCreate } from "../../hooks/use-inline-agent-create.js";
import { CreateAgentInline } from "../create-agent-inline.js";
import { type BindMessenger, BindPage } from "./bind-page.js";
import { withCommandChips } from "./command-chip.js";
import { PickerFooter } from "./picker-footer.js";
import { PickerSearch } from "./picker-search.js";
import { PickerSectionList } from "./picker-section-list.js";
import { pickerSections } from "./picker-sections.js";

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
  const bindConfirm = useBindSharingConfirm(selected);
  const whisper = copy.messenger === "slack" && selected?.whisper === true;
  const sharing = bindConfirm.body(copy.audience, whisper);

  const confirmPick = async () => {
    if (!selected) return;
    if (!(await bindConfirm.confirm(copy.audience, copy.action, whisper)))
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
          <AddAlt size={16} /> Create a new agent
        </Button>
      )}
    </BindPage>
  );
}

function PickerError({ error }: { error: Props["error"] }) {
  if (!error) return null;
  return (
    <p className="mt-4 text-sm text-danger">
      {error.title} — {withCommandChips(error.hint)}
    </p>
  );
}
