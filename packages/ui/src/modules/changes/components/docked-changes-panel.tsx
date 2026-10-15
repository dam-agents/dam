import { Close } from "@carbon/icons-react";
import {
  type ChangeSet,
  type CompareTo,
  compareToSchema,
} from "agent-runtime-api";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { useIsAgentOperable } from "../../agents/api/queries.js";
import { useChangeSetDiff, useChangeSets } from "../api/queries.js";
import { useChangeSetSelection } from "../hooks/use-change-set-selection.js";
import { useChangesWatch } from "../hooks/use-changes-watch.js";
import { type DiffLayout, fileDiffAnchor } from "../lib/diff-layout.js";
import { ChangeSetOptions } from "./change-set-options.js";
import { ChangeSetSelect } from "./change-set-select.js";
import { ChangeSetSummary } from "./change-set-summary.js";
import { ChangedFileList } from "./changed-file-list.js";
import { FileDiffCard } from "./file-diff-card.js";

interface Props {
  agentId: string;
  sessionId: string | null;
}

export function DockedChangesPanel({ agentId, sessionId }: Props) {
  const close = useStore((s) => s.setOpenChanges);
  const operable = useIsAgentOperable(agentId);
  const { data, error, isPending } = useChangeSets(agentId, sessionId);
  useChangesWatch(agentId, true);
  const changeSets = data?.changeSets;
  const { selection, select } = useChangeSetSelection(changeSets);
  const [compare, setCompare] = useState<CompareTo>("base");
  const [layout, setLayout] = useState<DiffLayout>("unified");
  const selected =
    changeSets?.find((changeSet) => changeSet.path === selection?.path) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        {changeSets && selection ? (
          <ChangeSetSelect
            changeSets={changeSets}
            selected={selected}
            seen={selection.seen}
            onSelect={select}
          />
        ) : (
          <span className="flex-1 text-sm font-medium text-foreground">
            Changes
          </span>
        )}
        <div className="w-36 shrink-0">
          <Select
            size="sm"
            aria-label="Compare to"
            value={compare}
            onChange={(event) => {
              const parsed = compareToSchema.safeParse(event.target.value);
              if (parsed.success) setCompare(parsed.data);
            }}
          >
            <option value="base">
              {selected?.baseRef ? `vs ${selected.baseRef}` : "vs base"}
            </option>
            <option value="uncommitted">Uncommitted</option>
          </Select>
        </div>
        <LayoutToggle layout={layout} onChange={setLayout} />
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label="Close"
          tooltip="Close"
          onClick={() => close(null)}
        >
          <Close size={16} />
        </Button>
      </div>
      {error ? (
        <Notice text={listErrorText(error.message)} />
      ) : !operable && !data ? (
        <Notice text="Changes show while the agent is running." />
      ) : isPending || !changeSets || !selection ? (
        <CenteredSpinner />
      ) : selected ? (
        <ChangeSetBody
          agentId={agentId}
          changeSet={selected}
          compare={compare}
          layout={layout}
        />
      ) : (
        <ChangeSetOptions
          changeSets={changeSets}
          selectedPath={null}
          seen={selection.seen}
          onSelect={select}
        />
      )}
    </div>
  );
}

function ChangeSetBody({
  agentId,
  changeSet,
  compare,
  layout,
}: {
  agentId: string;
  changeSet: ChangeSet;
  compare: CompareTo;
  layout: DiffLayout;
}) {
  const anchorPrefix = useId();
  const {
    data: diff,
    error,
    isPending,
  } = useChangeSetDiff(agentId, changeSet.path, compare);

  return (
    <>
      <ChangeSetSummary changeSet={changeSet} diff={diff} />
      {error ? (
        <Notice text={`Couldn't read the diff: ${error.message}`} />
      ) : isPending || !diff ? (
        <CenteredSpinner />
      ) : diff.files.length === 0 ? (
        <Notice
          text={
            compare === "base"
              ? "No changes against the base."
              : "No uncommitted changes."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="max-h-48 overflow-y-auto border-b border-border">
            <ChangedFileList files={diff.files} anchorPrefix={anchorPrefix} />
          </div>
          {diff.truncated && (
            <p className="px-4 pt-2 text-xs text-muted-foreground">
              Some files are not shown in full because the change is large.
            </p>
          )}
          <div className="flex flex-col gap-3 p-3">
            {diff.files.map((file, index) => (
              <FileDiffCard
                key={`${diff.path}:${diff.compare}:${file.path}`}
                file={file}
                layout={layout}
                anchor={fileDiffAnchor(anchorPrefix, index)}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: DiffLayout;
  onChange: (layout: DiffLayout) => void;
}) {
  const options: { value: DiffLayout; label: string }[] = [
    { value: "unified", label: "Unified" },
    { value: "split", label: "Split" },
  ];
  return (
    <div
      role="group"
      aria-label="Diff layout"
      className="flex shrink-0 rounded-md border border-input p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={layout === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground",
            layout === option.value && "bg-muted font-medium text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function listErrorText(message: string): string {
  return /procedure (found )?on path/i.test(message)
    ? "This agent's runtime cannot show changes yet. It can once the agent runs a newer image."
    : `Couldn't read the agent's repositories: ${message}`;
}

function CenteredSpinner() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Spinner />
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return <p className="px-4 py-3 text-sm text-muted-foreground">{text}</p>;
}
