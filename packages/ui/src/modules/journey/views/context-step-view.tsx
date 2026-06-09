import { Loader2, Plus, Upload, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import { api } from "../../../api.js";
import { emitToast } from "../../../lib/toast.js";
import { useStore } from "../../../store.js";
import { useCreateAgent } from "../../agents/api/mutations.js";
import {
  type BundleEntry,
  filterImportEntries,
  walkDataTransfer,
} from "../../files/api/import-bundle.js";
import { LabeledInput } from "../../v2/components/labeled-input.js";
import { useSandboxWizard } from "../../v2/hooks/use-sandbox-wizard.js";
import {
  type BrowsableSkill,
  useBrowsableSkills,
  useLinkSkillSource,
} from "../api/skills.js";
import { WizardLayout } from "../components/wizard-layout.js";

type SkillSelection = ReturnType<typeof useSandboxWizard>["snapshot"]["skills"];

function deriveSourceName(gitUrl: string): string {
  const last = gitUrl.trim().replace(/\/+$/, "").split("/").pop() ?? "";
  return last.replace(/\.git$/, "") || "skills";
}

export function ContextStepView() {
  const { snapshot, update, reset } = useSandboxWizard();
  const setView = useStore((s) => s.setView);
  const openAgentTerminal = useStore((s) => s.openAgentTerminal);
  const createAgent = useCreateAgent();

  // Local files live in component state — File objects can't be persisted to
  // the sessionStorage snapshot, so they don't survive an OAuth redirect.
  const [files, setFiles] = useState<BundleEntry[]>([]);

  const isCustom = snapshot.harness === "custom";

  const createSandbox = async () => {
    if (!snapshot.name.trim()) return;
    if (isCustom ? !snapshot.customImage.trim() : !snapshot.llmSecretId) return;
    const appConnectionIds = snapshot.connectionIds;

    const gitUrl = snapshot.gitRepoUrl.trim();
    const ref = snapshot.gitRepoRef.trim();

    const agent = await createAgent.mutateAsync({
      name: snapshot.name.trim(),
      egressPreset: snapshot.egressPreset,
      ...(isCustom
        ? { image: snapshot.customImage.trim() }
        : { templateId: snapshot.harness }),
      ...(snapshot.llmSecretId ? { secretIds: [snapshot.llmSecretId] } : {}),
      ...(appConnectionIds.length ? { appConnectionIds } : {}),
      ...(gitUrl ? { gitRepo: { url: gitUrl, ...(ref ? { ref } : {}) } } : {}),
      ...(files.length ? { importEntries: files } : {}),
    });

    if (snapshot.skills.length > 0) {
      const results = await Promise.allSettled(
        snapshot.skills.map((s) =>
          api.skills.install.mutate({ agentId: agent.id, ...s }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed > 0)
        emitToast({
          kind: "error",
          message: `${failed} skill${failed > 1 ? "s" : ""} couldn't be installed; add them later from the Skills tab.`,
        });
    }

    reset();
    openAgentTerminal(agent.id);
  };

  const creating = createAgent.isPending;

  return (
    <WizardLayout
      current="new-context"
      title="Add your Context"
      subtitle="Seed the sandbox with local files, a repo, or skills. All optional."
      onStepClick={setView}
      footer={
        <>
          <Button variant="outline" onClick={createSandbox} disabled={creating}>
            Skip this step
          </Button>
          <Button onClick={createSandbox} disabled={creating}>
            {creating && <Loader2 size={15} className="animate-spin" />}
            Create sandbox
          </Button>
        </>
      }
    >
      <LocalContextSection files={files} onChange={setFiles} />
      <GithubContextSection snapshot={snapshot} update={update} />
    </WizardLayout>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function LocalContextSection({
  files,
  onChange,
}: {
  files: BundleEntry[];
  onChange: (files: BundleEntry[]) => void;
}) {
  const [dragActive, setDragActive] = useState(false);

  const add = (incoming: BundleEntry[]) => {
    const { kept } = filterImportEntries(incoming);
    const seen = new Set(files.map((f) => f.path));
    onChange([...files, ...kept.filter((e) => !seen.has(e.path))]);
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    add(await walkDataTransfer(e.dataTransfer.items));
  };

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []).map((file) => ({
      path: file.name,
      file,
    }));
    add(picked);
    e.target.value = "";
  };

  return (
    <Section label="Local context">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-colors",
          dragActive
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50",
        )}
      >
        <Upload size={18} className="text-muted-foreground" />
        <span className="text-[13px] font-semibold text-foreground">
          Drop files here or click to choose
        </span>
        <span className="text-[12px] text-muted-foreground">
          Uploaded into the sandbox working directory.
        </span>
        <input type="file" multiple className="hidden" onChange={onPick} />
      </label>
      {files.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5">
          <span className="text-[13px] text-foreground">
            {files.length} file{files.length > 1 ? "s" : ""} ready
          </span>
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-destructive"
          >
            <X size={13} /> Clear
          </button>
        </div>
      )}
    </Section>
  );
}

function GithubContextSection({
  snapshot,
  update,
}: {
  snapshot: ReturnType<typeof useSandboxWizard>["snapshot"];
  update: (patch: Partial<typeof snapshot>) => void;
}) {
  return (
    <Section label="From GitHub">
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold text-foreground">
          Clone a repo into the sandbox
        </span>
        <LabeledInput
          label=""
          placeholder="https://github.com/org/repo"
          value={snapshot.gitRepoUrl}
          onChange={(gitRepoUrl) => update({ gitRepoUrl })}
        />
        {snapshot.gitRepoUrl.trim() && (
          <LabeledInput
            label="Branch or tag (optional)"
            placeholder="main"
            value={snapshot.gitRepoRef}
            onChange={(gitRepoRef) => update({ gitRepoRef })}
          />
        )}
        <p className="text-[12px] text-muted-foreground">
          If this repo is private, make sure you connected GitHub in the
          previous step so the clone can authenticate.
        </p>
      </div>

      <AttachSkills snapshot={snapshot} update={update} />
    </Section>
  );
}

function AttachSkills({
  snapshot,
  update,
}: {
  snapshot: ReturnType<typeof useSandboxWizard>["snapshot"];
  update: (patch: Partial<typeof snapshot>) => void;
}) {
  const { data: skills = [] } = useBrowsableSkills();
  const linkSource = useLinkSkillSource();

  const selectedKey = new Set(snapshot.skills.map(skillKey));

  const toggle = (skill: BrowsableSkill) => {
    const key = skillKey(skill);
    const next: SkillSelection = selectedKey.has(key)
      ? snapshot.skills.filter((s) => skillKey(s) !== key)
      : [
          ...snapshot.skills,
          {
            source: skill.source,
            name: skill.name,
            version: skill.version,
            contentHash: skill.contentHash,
          },
        ];
    update({ skills: next });
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold text-foreground">
        Attach skills from a repo
      </span>
      {skills.length > 0 && (
        <div className="flex flex-col gap-2">
          {skills.map((skill) => (
            <SkillRow
              key={skillKey(skill)}
              skill={skill}
              checked={selectedKey.has(skillKey(skill))}
              onToggle={() => toggle(skill)}
            />
          ))}
        </div>
      )}
      <LinkRepoForm
        busy={linkSource.isPending}
        onLink={(gitUrl) =>
          linkSource.mutateAsync({ name: deriveSourceName(gitUrl), gitUrl })
        }
      />
    </div>
  );
}

function SkillRow({
  skill,
  checked,
  onToggle,
}: {
  skill: BrowsableSkill;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-4 py-3 hover:border-primary/50">
      <Checkbox
        checked={checked}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-foreground">
            {skill.name}
          </span>
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {skill.sourceName}
          </span>
        </span>
        {skill.description && (
          <span className="mt-0.5 block text-[12px] text-muted-foreground">
            {skill.description}
          </span>
        )}
      </span>
    </label>
  );
}

function skillKey(s: { source: string; name: string }): string {
  return `${s.source}#${s.name}`;
}

function LinkRepoForm({
  busy,
  onLink,
}: {
  busy: boolean;
  onLink: (gitUrl: string) => Promise<unknown>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [gitUrl, setGitUrl] = useState("");

  if (!expanded)
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 self-start text-[13px] font-semibold text-primary hover:underline"
      >
        <Plus size={15} /> Link a skills repo
      </button>
    );

  const submit = async () => {
    if (!gitUrl.trim()) return;
    await onLink(gitUrl.trim());
    setGitUrl("");
    setExpanded(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
      <LabeledInput
        label=""
        placeholder="https://github.com/org/skills-repo"
        value={gitUrl}
        onChange={setGitUrl}
        hint="Paste a git repo of skills to make them selectable above."
      />
      <div className="flex items-center gap-2">
        <Button onClick={submit} disabled={busy || !gitUrl.trim()}>
          {busy && <Loader2 size={15} className="animate-spin" />}
          Link repo
        </Button>
        <Button
          variant="ghost"
          onClick={() => setExpanded(false)}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
