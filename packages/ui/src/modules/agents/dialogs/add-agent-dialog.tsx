import { Add as Plus, Checkmark, Code, DocumentAdd, Extensions, Folder, Globe, Password as Lock } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import * as SelectPrimitive from "@radix-ui/react-select";
import { ArrowLeft, ArrowRight, File as FileIcon, Folder as FolderIcon, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import type { EmptyStatePalette } from "../../../components/empty-state.js";
import { FormField } from "../../../components/form-field.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import {
  APP_OAUTH_SECRET_PREFIX,
  isCustomSecret,
  isMcpSecret,
  isProviderPresetType,
  mcpHostnameFromSecretName,
  PROVIDER_PRESET_TYPES,
  type ProviderPresetType,
  PROVIDERS,
} from "../../../types.js";
import type { OAuthAppDescriptor } from "../../connections/api/fetchers.js";
import {
  useAppConnections,
  useOAuthAppConnections,
  useOAuthApps,
} from "../../connections/api/queries.js";
import { OAuthAppIcon } from "../../connections/components/oauth-app-icon.js";
import { AddMcpForm } from "../../connections/forms/add-mcp-form.js";
import { ConnectAppForm } from "../../connections/forms/connect-app-form.js";
import { type BundleEntry, filterImportEntries, isTarballName, walkDataTransfer } from "../../files/api/import-bundle.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { CreateSecretForm } from "../../secrets/forms/create-secret-form.js";
import { PROVIDER_CARDS } from "../../settings/components/provider-cards.js";
import { PROVIDER_DESCRIPTIONS } from "../../settings/components/provider-chooser-dialog.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";
import { addAgentSchema, type AddAgentValues } from "../forms/add-agent-schema.js";

// Wizard steps. The scratch lane uses a single consolidated "setup"
// step that bundles name + description + harness + starting source +
// network into one screen (per the wireframe), then proceeds to
// connections → skills → submit. The template and custom lanes still
// use the older provider → basics → connections → skills → network
// progression — they'll be folded into the same shape later.
type Step =
  | "pick"
  | "provider"
  | "basics"
  | "setup"
  | "connections"
  | "skills"
  | "network";

// Three top-level starting paths surfaced after the provider is set.
// `null` shows the lane picker; choosing a lane reveals that lane's
// sub-picker (harness select / template catalog / custom image URL).
type Lane = "scratch" | "template" | "custom";

// Where the agent's initial workspace contents come from. Both options
// surface in the prototype even though the controller currently only
// honours local uploads — picking GitHub captures the repo URL into
// state for the spec, but submission silently drops it. Devs reviewing
// this prototype will see the intended shape end-to-end.
type StartingSource = "local" | "github";

// Until the api-server-api Template type carries prerequisite
// metadata, surface the meeting's "users need to know what an
// opinionated template requires *before* picking" insight via this
// hardcoded map keyed off template name. Replace with template.prereqs
// the moment that field exists on the contract.
const TEMPLATE_PREREQS: Record<string, string[]> = {
  "Google Workspace": ["Google OAuth (Gmail, Drive, Calendar)"],
  "Code Guardian": ["GitHub OAuth"],
};

const lookupPrereqs = (templateName: string): string[] => {
  for (const key of Object.keys(TEMPLATE_PREREQS)) {
    if (templateName.toLowerCase().includes(key.toLowerCase())) {
      return TEMPLATE_PREREQS[key];
    }
  }
  return [];
};

// Hardcoded skill catalog. The agent-runtime doesn't yet expose a
// skills enumeration, so this drives the wireframe-faithful Skills
// step on the prototype. Categories mirror the natural groupings the
// meeting transcript referenced (browsing, code, comms, data) and
// each entry is plausible based on the templates already shipping.
type SkillItem = {
  id: string;
  name: string;
  description: string;
};
type SkillCategory = {
  key: string;
  label: string;
  items: SkillItem[];
};
const SKILL_CATALOG: SkillCategory[] = [
  {
    key: "code",
    label: "Code & files",
    items: [
      { id: "python-repl", name: "Python REPL", description: "Execute Python code in a sandbox." },
      { id: "node-repl", name: "Node.js REPL", description: "Execute JavaScript / TypeScript snippets." },
      { id: "shell", name: "Shell", description: "Run shell commands inside the agent's workspace." },
      { id: "file-edit", name: "File editor", description: "Patch and create files in the agent's workspace." },
    ],
  },
  {
    key: "web",
    label: "Search & web",
    items: [
      { id: "web-search", name: "Web search", description: "Query the web for fresh, citable results." },
      { id: "browser", name: "Headless browser", description: "Drive a Playwright session for click-throughs and scraping." },
      { id: "doc-search", name: "Doc search", description: "Search across the internal docs index." },
    ],
  },
  {
    key: "comms",
    label: "Communication",
    items: [
      { id: "gmail", name: "Gmail", description: "Read and send mail. Requires the Google connection." },
      { id: "slack", name: "Slack", description: "Post to channels and read history. Requires the Slack connection." },
      { id: "calendar", name: "Calendar", description: "Read and create events. Requires the Google connection." },
    ],
  },
  {
    key: "data",
    label: "Data",
    items: [
      { id: "postgres", name: "Postgres", description: "Query a configured Postgres database." },
      { id: "bigquery", name: "BigQuery", description: "Run BigQuery jobs against your warehouse." },
      { id: "github-ops", name: "GitHub operations", description: "Open PRs, comment, manage issues. Requires the GitHub connection." },
    ],
  },
];

export function AddAgentDialog({
  templates,
  onSubmit,
  onCancel,
  onGoToProviders,
}: {
  templates: TemplateView[];
  onSubmit: (i: {
    name: string;
    templateId?: string;
    image?: string;
    description?: string;
    env?: EnvVar[];
    secretIds?: string[];
    appConnectionIds?: string[];
    egressPreset?: EgressPreset;
    importEntries?: BundleEntry[];
    importRawBundle?: File;
  }) => void;
  onCancel: () => void;
  onGoToProviders: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [lane, setLane] = useState<Lane | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(
    null,
  );
  const [customImage, setCustomImage] = useState("");
  // Two payload shapes the dialog can hold:
  //   - BundleEntry[] (folder pick, multi-file pick, walked drop) — wrapped
  //     into a tar client-side at submit time.
  //   - File (single .tar/.tar.gz/.tgz) — sent through verbatim, no re-wrap.
  // Pass-through only applies as a "clean slate happy path". The moment the
  // user adds anything else, we fold the raw bundle into entries and switch
  // to wrap mode so additional picks keep working.
  const [importEntries, setImportEntries] = useState<BundleEntry[]>([]);
  const [importRawBundle, setImportRawBundle] = useState<File | null>(null);
  // Running totals across every pick/drop the user has done so far.
  // `kept` and `dropped` sum to the browser's pre-filter count (the number
  // shown in Chrome's "Upload N files?" confirmation), so the caption can
  // expose both numbers and they reconcile.
  const [importDropped, setImportDropped] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  // Starting-source toggle. Local files is the working path; GitHub
  // repo is rendered for wireframe completeness but disabled until the
  // controller learns to clone at boot. The field stays mounted (and
  // shows as "Coming soon") so users discover the future direction.
  const [startingSource, setStartingSource] = useState<StartingSource>("local");
  const [gitRepoUrl, setGitRepoUrl] = useState("");
  // Selected skill IDs from the prototype skill catalog. Held as a
  // Set for O(1) toggle; not submitted (the agent-runtime has no
  // skills field yet). The catalog is hardcoded above; this just
  // captures the user's intent for the wireframe walkthrough.
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const toggleSkill = (id: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const importFolderInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const appendEntries = (incoming: BundleEntry[]) => {
    const { kept, dropped } = filterImportEntries(incoming);
    setImportEntries((prev) => {
      // If we were in pass-through mode, the user is now building a
      // multi-file import — fold the raw bundle in as a regular file so
      // it's still included.
      const base =
        importRawBundle && prev.length === 0
          ? [{ path: importRawBundle.name, file: importRawBundle }]
          : prev;
      const seen = new Set(base.map((e) => e.path));
      const merged = [...base];
      for (const e of kept) {
        if (seen.has(e.path)) continue;
        seen.add(e.path);
        merged.push(e);
      }
      return merged;
    });
    setImportRawBundle(null);
    setImportDropped((prev) => prev + dropped);
  };

  // Group flat entries by their top-level path segment so the chip list
  // can show one row per dropped folder / picked file rather than thousands.
  // `count` is entries under that top-level; `isFolder` is true when any
  // entry lives below it (i.e. has a `/` after the top segment).
  const importGroups = useMemo(() => {
    const counts = new Map<string, number>();
    const folders = new Set<string>();
    for (const e of importEntries) {
      const top = e.path.split("/")[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
      if (e.path.includes("/")) folders.add(top);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({
      name,
      count,
      isFolder: folders.has(name),
    }));
  }, [importEntries]);

  const removeGroup = (name: string) => {
    setImportEntries((prev) =>
      prev.filter((e) => e.path.split("/")[0] !== name),
    );
  };

  // Pass-through only when the user picks/drops exactly one tarball at
  // the root and nothing else is selected yet. The `!includes("/")` guard
  // keeps a folder containing exactly one .tar.gz from silently dropping
  // the folder wrapper.
  const handleIncoming = (incoming: BundleEntry[]) => {
    if (
      incoming.length === 1 &&
      isTarballName(incoming[0].path) &&
      !incoming[0].path.includes("/") &&
      importEntries.length === 0 &&
      !importRawBundle
    ) {
      setImportRawBundle(incoming[0].file);
      setImportDropped(0);
      return;
    }
    appendEntries(incoming);
  };

  const { data: secrets = [], isLoading: loadSecrets } = useSecrets();
  const { data: apps = [] } = useAppConnections();
  const { data: oauthAppConnections = [] } = useOAuthAppConnections();
  const { data: oauthApps = [] } = useOAuthApps();
  // GitHub-from-dropzone OAuth flow. Click the GitHub button in the
  // local-files dropzone → render ConnectAppForm in a sub-dialog (the
  // exact same UI the connections page uses, so credentials, callback
  // URL guidance, and default-app behaviour all stay consistent).
  const [connectingGitHub, setConnectingGitHub] = useState<OAuthAppDescriptor | null>(null);
  const githubDescriptor = useMemo(
    () => oauthApps.find((a) => a.id === "github"),
    [oauthApps],
  );

  // Sub-dialog state for the scratch lane's connections step. Mirrors
  // the connections page's pattern (ConnectAppForm / AddMcpForm /
  // CreateSecretForm) so users can create + grant new connections
  // without leaving the agent creation flow.
  const [connectingApp, setConnectingApp] = useState<OAuthAppDescriptor | null>(null);
  const [showAddMcp, setShowAddMcp] = useState(false);
  const [showAddSecret, setShowAddSecret] = useState(false);

  // Apps the scratch lane can still surface as "Connect": the multi-instance
  // ones plus any single-instance ones that aren't connected yet.
  const connectedAppIds = useMemo(
    () => new Set(oauthAppConnections.map((c) => c.appId)),
    [oauthAppConnections],
  );
  const availableToConnect = useMemo(
    () =>
      oauthApps.filter(
        (app) => app.cardinality === "multiple" || !connectedAppIds.has(app.id),
      ),
    [oauthApps, connectedAppIds],
  );

  const {
    register,
    handleSubmit,
    watch,
    getValues,
    setValue,
    reset,
    trigger,
    formState,
  } = useForm<AddAgentValues>({
    resolver: zodResolver(addAgentSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      description: "",
      selSecrets: [],
      selApps: [],
      egressPreset: "trusted",
    },
  });
  const { errors, isSubmitting, isValid } = formState;

  // Auto-baseline the selSecrets default with the lone provider preset
  // (Anthropic / IBM LiteLLM) so the picker reflects the typical "of course
  // you want this" default. The submit always sends selSecrets —
  // `setAgentAccess` is what creates the connection-derived egress rules,
  // and skipping it on undirty leaves the agent with no rules for the
  // granted secret.
  const baselinedRef = useRef(false);
  useEffect(() => {
    if (baselinedRef.current) return;
    if (secrets.length === 0) return;
    baselinedRef.current = true;
    const providers = secrets.filter((s) => isProviderPresetType(s.type));
    if (providers.length === 1) {
      reset({ ...getValues(), selSecrets: [providers[0].id] });
    }
  }, [secrets, reset, getValues]);

  const toggleSecret = (id: string) => {
    const current = getValues("selSecrets");
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id].sort();
    setValue("selSecrets", next, { shouldDirty: true, shouldValidate: true });
  };
  const toggleApp = (id: string) => {
    const current = getValues("selApps");
    const next = current.includes(id)
      ? current.filter((x) => x !== id)
      : [...current, id].sort();
    setValue("selApps", next, { shouldDirty: true });
  };

  const selSecrets = watch("selSecrets");
  const selApps = watch("selApps");
  const selSecretsSet = useMemo(() => new Set(selSecrets), [selSecrets]);
  const selAppsSet = useMemo(() => new Set(selApps), [selApps]);

  // Join the api-server-driven OAuth app connections with their K8s
  // credential Secrets so the picker can render them in the "Apps"
  // subsection while the grant flows through the secret-access mechanism.
  const oauthAppEntries: OAuthAppEntry[] = [];

  const pickTemplate = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
    setValue("name", tmpl.name);
    setValue("description", tmpl.description ?? "");
    // Force validation so isValid reflects the prefilled template values —
    // setValue defaults to skipping it and the user might submit without ever
    // typing in the field.
    trigger();
    setStep("provider");
  };

  const pickCustom = () => {
    const img = customImage.trim();
    if (!img) return;
    setSelectedTemplate(null);
    setValue("name", "");
    setValue("description", "");
    trigger();
    setStep("provider");
  };

  // Wizard nav. `next` validates the leaving step's required fields
  // before advancing; `back` is unconditional and rewinds to the prior
  // step (or all the way back to the lane picker from the first
  // post-lane step).
  const goNext = async () => {
    if (step === "provider") {
      setStep("basics");
    } else if (step === "setup") {
      const ok = await trigger(["name"]);
      if (!ok) return;
      setStep("connections");
    } else if (step === "basics") {
      const ok = await trigger(["name"]);
      if (!ok) return;
      setStep("connections");
    } else if (step === "connections") {
      setStep("skills");
    } else if (step === "skills") {
      // Scratch flow ends at skills (Create agent button is rendered
      // there). Other lanes still walk through the network step.
      if (lane !== "scratch") setStep("network");
    }
  };
  const goBack = () => {
    if (step === "provider") {
      setStep("pick");
      setLane(null);
    } else if (step === "setup") {
      setStep("pick");
      setLane(null);
      setSelectedTemplate(null);
    } else if (step === "basics") {
      setStep("provider");
    } else if (step === "connections") {
      setStep(lane === "scratch" ? "setup" : "basics");
    } else if (step === "skills") {
      setStep("connections");
    } else if (step === "network") {
      setStep("skills");
    }
  };

  // Lane pick handler. Scratch jumps straight to the consolidated
  // setup step with the first available template auto-selected as the
  // default harness — the user picks the harness via segmented buttons
  // on that step rather than a separate card list.
  const handleLanePick = (l: Lane) => {
    setLane(l);
    if (l === "scratch") {
      if (templates.length > 0) {
        setSelectedTemplate(templates[0]);
      }
      setStep("setup");
    }
  };

  const pickHarness = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
  };

  const submitForm = handleSubmit((values) => {
    // ADR-040: env contributions from granted secrets/apps are merged at
    // pod-render time by the controller. Don't pre-stamp them onto the
    // agent spec.
    onSubmit({
      name: values.name.trim(),
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      description: values.description.trim() || undefined,
      // Always send the picker's state — even when the user hasn't toggled,
      // the baselined default (single provider preset) is real intent and
      // `setAgentAccess` is what triggers the connection-rules sync
      // server-side. Skipping it on undirty leaves the agent with no
      // connection-derived egress rules.
      secretIds: values.selSecrets,
      appConnectionIds: values.selApps.length > 0 ? values.selApps : undefined,
      egressPreset: values.egressPreset,
      importEntries: importEntries.length > 0 ? importEntries : undefined,
      importRawBundle: importRawBundle ?? undefined,
    });
  });

  const providerSecrets = secrets.filter((s) => isProviderPresetType(s.type));
  const configuredProviderTypes = useMemo(
    () =>
      new Set(
        providerSecrets.map((s) => s.type as ProviderPresetType),
      ),
    // Identity reuse — the Set rebuilds only when the provider list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerSecrets.map((s) => s.id).join("|")],
  );

  // Inline provider setup — picking a preset from the dropdown's "Set up
  // new" group shows that preset's card form right below the field.
  // After the user saves a key, the secret list refetches; this effect
  // notices the type now has a configured secret and closes the setup
  // card.
  const [pickedProvider, setPickedProvider] = useState<ProviderPresetType | null>(null);

  useEffect(() => {
    if (pickedProvider && configuredProviderTypes.has(pickedProvider)) {
      setPickedProvider(null);
    }
  }, [pickedProvider, configuredProviderTypes]);

  // Which configured provider secret is "the primary" for this agent?
  // Read off selSecrets so the form stays the source of truth — the
  // auto-baselining effect above seeds the first provider when there's
  // exactly one configured.
  const selSecretsArr = watch("selSecrets");
  const selectedProviderSecretId =
    providerSecrets.find((p) => selSecretsArr.includes(p.id))?.id ?? null;
  const setSelectedProviderSecret = (secretId: string) => {
    const otherProviderIds = providerSecrets.map((p) => p.id).filter((id) => id !== secretId);
    const next = selSecretsArr.filter((id) => !otherProviderIds.includes(id));
    if (!next.includes(secretId)) next.push(secretId);
    setValue("selSecrets", next.sort(), { shouldDirty: true, shouldValidate: true });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
          {step === "pick" && lane === null && (
            <DialogDescription>
              Choose how you want to start
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Lane picker → wizard. The provider chooser used to live at
            the top of the dialog; it now sits in its own wizard step
            (with a Skip-for-now affordance) so the lane decision can
            be made first and provider isn't a blocking gate. */}

          {step === "pick" ? (
            lane === null ? (
              <LanePicker onPick={handleLanePick} />
            ) : lane === "scratch" ? (
              <LaneFrame
                title="Pick a harness"
                description="Vanilla Claude Code, Pi, or Bob — the agent starts with no skills, no repo, just the harness ready to go."
                onBack={() => setLane(null)}
              >
                {templates.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {templates.map((tmpl) => (
                      <TemplateRowCard
                        key={tmpl.id}
                        template={tmpl}
                        prereqs={[]}
                        onPick={() => pickTemplate(tmpl)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No harnesses available. Check your cluster's agent
                    template configuration.
                  </p>
                )}
              </LaneFrame>
            ) : lane === "template" ? (
              <LaneFrame
                title="Browse templates"
                description="Pre-configured agents with skills, connections, and prompts wired in. Required connections are listed up-front so you know what to wire in before you commit."
                onBack={() => setLane(null)}
              >
                {templates.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {templates.map((tmpl) => (
                      <TemplateRowCard
                        key={tmpl.id}
                        template={tmpl}
                        prereqs={lookupPrereqs(tmpl.name)}
                        onPick={() => pickTemplate(tmpl)}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    Template catalog is empty. Add opinionated templates
                    to your cluster's agent template config to surface them
                    here.
                  </p>
                )}
              </LaneFrame>
            ) : (
              <LaneFrame
                title="Custom image"
                description="Bring your own ACP-compatible agent image — for harnesses you've built or specialized runtimes that need bundled CLIs."
                onBack={() => setLane(null)}
              >
                <div className="flex gap-2">
                  <Input
                    value={customImage}
                    onChange={(e) => setCustomImage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        pickCustom();
                      }
                    }}
                    placeholder="ghcr.io/org/agent:latest"
                    autoFocus
                  />
                  <Button
                    type="button"
                    onClick={pickCustom}
                    disabled={!customImage.trim()}
                    className="shrink-0"
                  >
                    Use
                  </Button>
                </div>
              </LaneFrame>
            )
          ) : step === "setup" ? null : (
            <>
              {/* Persistent image readout — shown on every non-pick,
                  non-setup step so the user can always see what they're
                  configuring against. The setup step has its own
                  harness picker, so the readout would be redundant
                  there. */}
              <FormField label="Image">
                <div className="flex items-center gap-2 rounded-lg border bg-background px-4 py-2.5">
                  <span className="text-[13px] text-foreground flex-1 min-w-0 truncate">
                    {selectedTemplate ? (
                      <HoverTooltip
                        placement="right"
                        trigger={
                          <span className="font-semibold border-b border-dotted border-muted-foreground cursor-help">
                            {selectedTemplate.name}
                          </span>
                        }
                      >
                        <span className="font-mono">{selectedTemplate.image}</span>
                      </HoverTooltip>
                    ) : (
                      <span className="font-mono break-all">{customImage}</span>
                    )}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setStep("pick");
                      setLane(null);
                    }}
                  >
                    Change
                  </Button>
                </div>
              </FormField>
            </>
          )}

          {/* Provider step — sits OUTSIDE the agent form because the
              inline provider setup card renders its own nested <form>,
              and HTML doesn't allow form nesting. Skip-for-now is a
              first-class affordance: the wireframe lets users defer
              this until they actually need to reach a model. */}
          {step === "provider" && (
            <fieldset className="flex flex-col gap-3 anim-in">
              <ProviderPickerSection
                providerSecrets={providerSecrets}
                configuredTypes={configuredProviderTypes}
                picked={pickedProvider}
                onPick={setPickedProvider}
                selectedProviderSecretId={selectedProviderSecretId}
                onSelectProviderSecret={setSelectedProviderSecret}
              />
              {!selectedProviderSecretId && !pickedProvider && (
                <p className="text-[12px] text-muted-foreground leading-relaxed">
                  Don't have one yet? Click <span className="font-semibold text-foreground">Skip for now</span> —
                  the agent will be created without a provider and can't
                  reach a model until you wire one up later from the
                  Providers page.
                </p>
              )}
            </fieldset>
          )}

          {/* Single <form> wrapping the wizard's input steps.
              Sections render conditionally per step but the underlying
              react-hook-form state is shared, so values persist as the
              user moves Back/Next. The form is scoped here so a save in
              the provider's setup form (rendered on the provider step
              above) doesn't bubble up and submit the agent. */}
          {(step === "setup" || step === "basics" || step === "connections" || step === "skills" || step === "network") && (
            <form onSubmit={submitForm} className="contents">
            {(step === "basics" || step === "setup") && (
              <>
            <FormField label="Name" error={errors.name?.message}>
              <Input placeholder="my-agent" autoFocus {...register("name")} />
            </FormField>
            <FormField label="Description (optional)">
              <Input placeholder="What does this agent do?" {...register("description")} />
            </FormField>

            {step === "setup" && (
              <FormField label="Harness">
                {templates.length > 0 ? (
                  <Select
                    value={selectedTemplate?.id ?? ""}
                    onValueChange={(id) => {
                      const tmpl = templates.find((t) => t.id === id);
                      if (tmpl) pickHarness(tmpl);
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Pick a harness" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((tmpl) => (
                        <SelectItem key={tmpl.id} value={tmpl.id}>
                          {tmpl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="text-[12px] text-muted-foreground">
                    No harnesses available. Check your cluster's agent template configuration.
                  </p>
                )}
              </FormField>
            )}

            {step === "basics" && (
            <FormField label="Starting source">
              <RadioGroup
                value={startingSource}
                onValueChange={(v) => setStartingSource(v as StartingSource)}
                className="flex flex-col gap-1.5"
              >
                <Label
                  htmlFor="src-local"
                  className={cn(
                    "flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5",
                    startingSource === "local" && "border-primary",
                  )}
                >
                  <RadioGroupItem value="local" id="src-local" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Upload local files</span>
                    <span className="text-[12px] text-muted-foreground">Drop a folder, files, or a <code className="font-mono">.tar.gz</code> bundle to seed the agent's workspace.</span>
                  </span>
                </Label>
                <Label
                  htmlFor="src-github"
                  className={cn(
                    "flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5",
                    startingSource === "github" && "border-primary",
                  )}
                >
                  <RadioGroupItem value="github" id="src-github" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Clone a GitHub repo</span>
                    <span className="text-[12px] text-muted-foreground">Agent boots with your repo cloned into <code className="font-mono">/workspace</code>, credentials sourced from a connection.</span>
                  </span>
                </Label>
              </RadioGroup>
              {startingSource === "github" && (
                <div className="mt-2 flex flex-col gap-1.5">
                  <Input
                    value={gitRepoUrl}
                    onChange={(e) => setGitRepoUrl(e.target.value)}
                    placeholder="https://github.com/org/repo"
                  />
                  <span className="text-[11px] text-muted-foreground italic">
                    Prototype: the URL is captured but the controller doesn't yet clone — devs, see the related issue.
                  </span>
                </div>
              )}
            </FormField>
            )}

            {((step === "basics" && startingSource === "local") || step === "setup") && (
            <FormField label="Import local context (optional)">
              <input
                ref={importFolderInputRef}
                type="file"
                multiple
                // @ts-expect-error -- non-standard but supported by Chromium-based + Safari + Firefox
                webkitdirectory=""
                directory=""
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  handleIncoming(
                    Array.from(files).map((f) => ({
                      path:
                        (f as File & { webkitRelativePath?: string })
                          .webkitRelativePath || f.name,
                      file: f,
                    })),
                  );
                  e.target.value = "";
                }}
              />
              <input
                ref={importFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  handleIncoming(
                    Array.from(files).map((f) => ({ path: f.name, file: f })),
                  );
                  e.target.value = "";
                }}
              />
              <div
                onDragEnter={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    setDropActive(true);
                  }
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer?.types?.includes("Files")) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                  }
                }}
                onDragLeave={(e) => {
                  if (e.currentTarget.contains(e.relatedTarget as Node | null))
                    return;
                  setDropActive(false);
                }}
                onDrop={(e) => {
                  if (!e.dataTransfer) return;
                  e.preventDefault();
                  setDropActive(false);
                  const items = e.dataTransfer.items;
                  if (items && items.length > 0) {
                    void (async () => {
                      const entries = await walkDataTransfer(items);
                      handleIncoming(entries);
                    })();
                  }
                }}
                className={cn(
                  "rounded-lg border border-dashed px-4 py-6 transition-colors flex flex-col items-center gap-3 text-center",
                  dropActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-foreground/30",
                )}
              >
                {importRawBundle ? (
                  <>
                    <FileIcon size={24} className="text-muted-foreground" />
                    <div className="text-[13px] text-foreground">
                      <code className="font-mono">{importRawBundle.name}</code>
                    </div>
                  </>
                ) : importEntries.length > 0 ? (
                  <>
                    <Upload size={24} className="text-muted-foreground" />
                    <div className="text-[13px] text-foreground">
                      <span className="font-semibold">{importEntries.length + importDropped}</span> file{importEntries.length + importDropped === 1 ? "" : "s"} selected ·{" "}
                      <span className="text-foreground/80">{importEntries.length} to import</span>
                      {importDropped > 0 && (
                        <>
                          {" "}·{" "}
                          <span className="text-muted-foreground">{importDropped} filtered (<code className="font-mono">node_modules</code>, <code className="font-mono">.venv</code>, etc.)</span>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Upload size={28} className="text-muted-foreground" />
                    <div className="text-[13px] text-foreground">Drop a folder or files here</div>
                    <div className="text-[11px] text-muted-foreground">
                      <code className="font-mono">.tar.gz</code> bundles pass through verbatim
                    </div>
                  </>
                )}
                <div className="flex items-center gap-2 flex-wrap justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importFolderInputRef.current?.click()}
                  >
                    <Folder size={14} /> Choose folder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importFileInputRef.current?.click()}
                  >
                    <FileIcon size={14} /> Choose files
                  </Button>
                  {step === "setup" && githubDescriptor && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConnectingGitHub(githubDescriptor)}
                    >
                      <OAuthAppIcon appId="github" alt="GitHub" size={14} /> GitHub
                    </Button>
                  )}
                  {(importRawBundle || importEntries.length > 0) && (
                    <Button
                      type="button"
                      variant="link"
                      size="sm"
                      onClick={() => { setImportEntries([]); setImportRawBundle(null); setImportDropped(0); }}
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </div>
              {importGroups.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {importGroups.map((g) => (
                    <span
                      key={g.name}
                      className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px] text-foreground max-w-full"
                    >
                      {g.isFolder ? (
                        <FolderIcon size={12} className="text-muted-foreground shrink-0" />
                      ) : (
                        <FileIcon size={12} className="text-muted-foreground shrink-0" />
                      )}
                      <span className="font-mono truncate" title={g.name}>
                        {g.name}
                      </span>
                      {g.isFolder && (
                        <span className="text-muted-foreground shrink-0">({g.count})</span>
                      )}
                      <button
                        type="button"
                        onClick={() => removeGroup(g.name)}
                        className="text-muted-foreground hover:text-foreground shrink-0"
                        aria-label={`Remove ${g.name}`}
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </FormField>
            )}
              </>
            )}

            {step === "connections" && lane === "scratch" && (
              <ScratchConnectionsStep
                oauthAppEntries={oauthAppEntries}
                availableToConnect={availableToConnect}
                mcpSecrets={secrets.filter(isMcpSecret)}
                customSecrets={secrets.filter(isCustomSecret)}
                selSecretsSet={selSecretsSet}
                onToggleSecret={toggleSecret}
                onConnectApp={setConnectingApp}
                onAddMcp={() => setShowAddMcp(true)}
                onAddSecret={() => setShowAddSecret(true)}
              />
            )}

            {step === "connections" && lane !== "scratch" && (
            <ConnectionsPicker
              loading={loadSecrets}
              secrets={secrets}
              apps={apps as unknown as AppConnectionView[]}
              oauthApps={oauthAppEntries}
              selSecrets={selSecretsSet}
              selApps={selAppsSet}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
              onGoToProviders={onGoToProviders}
            />
            )}

            {step === "skills" && (
              <SkillsPicker
                selected={selectedSkills}
                onToggle={toggleSkill}
                template={selectedTemplate}
              />
            )}

            {(step === "network" || step === "setup") && (
            <fieldset className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                Network access
              </span>
              <p className="text-[12px] text-muted-foreground">
                Initial set of hosts the agent can reach. Anything not covered
                surfaces in the inbox; you can change this later from the
                agent's Network access tab.
              </p>
              <RadioGroup
                value={watch("egressPreset")}
                onValueChange={(v) =>
                  setValue("egressPreset", v as EgressPreset, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
                className="flex flex-col gap-1.5"
              >
                <Label
                  htmlFor="egress-trusted"
                  className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5"
                >
                  <RadioGroupItem value="trusted" id="egress-trusted" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Trusted defaults (recommended)</span>
                    <span className="text-[12px] text-muted-foreground">npm, PyPI, GitHub, package mirrors, Anthropic</span>
                  </span>
                </Label>
                <Label
                  htmlFor="egress-none"
                  className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5"
                >
                  <RadioGroupItem value="none" id="egress-none" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Strict default-deny</span>
                    <span className="text-[12px] text-muted-foreground">Every host hits the inbox until you approve</span>
                  </span>
                </Label>
                <Label
                  htmlFor="egress-all"
                  className="flex items-start gap-2 cursor-pointer rounded-lg border border-warning/40 bg-background px-4 py-2.5"
                >
                  <RadioGroupItem value="all" id="egress-all" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Allow everything</span>
                    <span className="text-[12px] text-muted-foreground">Development escape hatch — no inbox prompts</span>
                  </span>
                </Label>
              </RadioGroup>
            </fieldset>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={goBack}>
                <ArrowLeft size={14} />
                {step === "basics" ? "Change image" : "Back"}
              </Button>
              {step === "network" || (step === "skills" && lane === "scratch") ? (
                <Button type="submit" disabled={isSubmitting || !isValid}>
                  Create agent
                </Button>
              ) : (
                <Button type="button" onClick={goNext}>
                  {step === "setup" ? "Continue" : "Next"} <ArrowRight size={14} />
                </Button>
              )}
            </DialogFooter>
            </form>
          )}

          {step === "provider" && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={goBack}>
                <ArrowLeft size={14} /> Back
              </Button>
              <Button
                type="button"
                onClick={goNext}
                variant={selectedProviderSecretId ? "default" : "outline"}
              >
                {selectedProviderSecretId ? (
                  <>Next <ArrowRight size={14} /></>
                ) : (
                  <>Skip for now <ArrowRight size={14} /></>
                )}
              </Button>
            </DialogFooter>
          )}
      </DialogContent>
      {connectingGitHub && (
        <ConnectAppForm
          app={connectingGitHub}
          onCancel={() => setConnectingGitHub(null)}
        />
      )}
      {connectingApp && (
        <ConnectAppForm
          app={connectingApp}
          onCancel={() => setConnectingApp(null)}
        />
      )}
      {showAddMcp && (
        <AddMcpForm
          onCancel={() => setShowAddMcp(false)}
        />
      )}
      {showAddSecret && (
        <CreateSecretForm
          onCancel={() => setShowAddSecret(false)}
          onCreated={() => setShowAddSecret(false)}
        />
      )}
    </Dialog>
  );
}

// Synthetic value prefix on "Set up new" rows so the single Select can
// distinguish "select an existing secret by id" from "kick off a setup
// flow for this preset".
const SETUP_VALUE_PREFIX = "setup:";

function ProviderPickerSection({
  providerSecrets,
  configuredTypes,
  picked,
  onPick,
  selectedProviderSecretId,
  onSelectProviderSecret,
}: {
  providerSecrets: { id: string; name: string; type: string }[];
  configuredTypes: Set<ProviderPresetType>;
  picked: ProviderPresetType | null;
  onPick: (type: ProviderPresetType | null) => void;
  selectedProviderSecretId: string | null;
  onSelectProviderSecret: (secretId: string) => void;
}) {
  const PickedCard = picked ? PROVIDER_CARDS[picked] : null;
  const available = PROVIDER_PRESET_TYPES.filter((t) => !configuredTypes.has(t));

  const handlePick = (value: string) => {
    if (value.startsWith(SETUP_VALUE_PREFIX)) {
      onPick(value.slice(SETUP_VALUE_PREFIX.length) as ProviderPresetType);
      return;
    }
    onSelectProviderSecret(value);
  };

  // The trigger reflects the in-flight "Adding X" preset until a key is
  // saved; otherwise it shows whichever existing provider secret is the
  // selected one for this agent.
  const triggerValue = picked
    ? `${SETUP_VALUE_PREFIX}${picked}`
    : (selectedProviderSecretId ?? "");

  const placeholder =
    providerSecrets.length === 0 ? "Set up a provider…" : "Pick a provider…";

  return (
    <FormField label="Provider">
      <div className="flex flex-col gap-3">
        <Select value={triggerValue} onValueChange={handlePick}>
          <SelectTrigger>
            <SelectValue placeholder={placeholder} />
          </SelectTrigger>
          <SelectContent>
            {/* Each row uses a custom item so the description can sit
                OUTSIDE Radix's ItemText — that way the trigger only shows
                the icon + name (compact), but the dropdown row shows the
                full sub-header underneath. */}
            {providerSecrets.map((s) => {
              const isPreset = s.type in PROVIDERS;
              const presetType = isPreset
                ? (s.type as ProviderPresetType)
                : null;
              const meta = presetType ? PROVIDERS[presetType] : null;
              return (
                <ProviderRowItem
                  key={s.id}
                  value={s.id}
                  iconProvider={presetType}
                  title={meta?.displayName ?? s.name}
                  description={presetType ? PROVIDER_DESCRIPTIONS[presetType] : undefined}
                  badge={
                    <Badge variant="secondary" className="gap-1">
                      <Checkmark className="h-3 w-3" /> Connected
                    </Badge>
                  }
                />
              );
            })}
            {available.map((id) => (
              <ProviderRowItem
                key={id}
                value={`${SETUP_VALUE_PREFIX}${id}`}
                iconProvider={id}
                title={PROVIDERS[id].displayName}
                description={PROVIDER_DESCRIPTIONS[id]}
              />
            ))}
          </SelectContent>
        </Select>

        {PickedCard && (
          <Card className="bg-primary/5 p-4 flex flex-col gap-3 anim-in">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.05em] text-primary">
                Adding {PROVIDERS[picked!].displayName}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => onPick(null)}
                aria-label="Cancel adding provider"
              >
                <X size={14} />
              </Button>
            </div>
            <PickedCard secret={undefined} />
          </Card>
        )}
      </div>
    </FormField>
  );
}

/**
 * Provider dropdown row — built on Radix's SelectPrimitive directly so
 * the description sub-header can sit outside `ItemText` (and therefore
 * outside the trigger's render of the selected value). The trigger stays
 * compact (icon + name + optional badge); the dropdown row shows the
 * description below.
 */
function ProviderRowItem({
  value,
  iconProvider,
  title,
  description,
  badge,
}: {
  value: string;
  iconProvider: ProviderPresetType | null;
  title: string;
  description?: string;
  badge?: React.ReactNode;
}) {
  return (
    <SelectPrimitive.Item
      value={value}
      className={cn(
        "relative flex flex-col cursor-default select-none rounded-sm py-2 pl-2 pr-2 text-sm outline-hidden",
        "focus:bg-muted focus:text-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      )}
    >
      <SelectPrimitive.ItemText>
        <span className="flex items-center gap-2.5">
          {iconProvider && <CardIcon provider={iconProvider} size="sm" />}
          <span className="text-[14px] font-semibold text-foreground">
            {title}
          </span>
          {badge}
        </span>
      </SelectPrimitive.ItemText>
      {description && (
        <span className="text-[12px] text-muted-foreground leading-snug mt-1 pl-[38px] block">
          {description}
        </span>
      )}
    </SelectPrimitive.Item>
  );
}

/**
 * Single browseable card for the scratch / template lanes. Replaces
 * the previous dropdown Select so prereqs and descriptions are
 * visible up-front (the meeting flagged "users need to know what an
 * opinionated template requires before picking" — pills hidden behind
 * a Select trigger broke that). Hover reveals the chevron + soft
 * surface tint; the whole card is the click target.
 */
function TemplateRowCard({
  template,
  prereqs,
  onPick,
}: {
  template: TemplateView;
  prereqs: string[];
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        "group flex flex-col gap-1.5 rounded-lg border bg-background px-4 py-3 text-left",
        "transition-colors hover:border-foreground/30 hover:bg-muted/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span className="flex items-center gap-2">
        <span className="text-[14px] font-semibold text-foreground">
          {template.name}
        </span>
        <ArrowRight
          size={14}
          className="text-muted-foreground ml-auto transition-transform group-hover:translate-x-0.5"
          aria-hidden
        />
      </span>
      {template.description && (
        <span className="text-[12px] text-muted-foreground leading-snug">
          {template.description}
        </span>
      )}
      {prereqs.length > 0 && (
        <span className="flex flex-wrap items-center gap-1 mt-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
            Requires
          </span>
          {prereqs.map((p) => (
            <span
              key={p}
              className="text-[11px] rounded-full border bg-muted/40 px-2 py-0.5 text-foreground/80"
            >
              {p}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}

/**
 * Skills picker. Categorised list of toggleable skill items driven
 * by the hardcoded {@link SKILL_CATALOG}. The wireframe shows skills
 * as a first-class wizard step with grouped checkboxes, so the
 * prototype renders that shape directly even though the agent-runtime
 * has no skills enumeration yet — selected IDs are captured in state
 * but not submitted. Devs reviewing the prototype see the intended
 * picker UX end-to-end; the real catalog comes from the runtime later.
 */
function SkillsPicker({
  selected,
  onToggle,
  template,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  template: TemplateView | null;
}) {
  return (
    <fieldset className="flex flex-col gap-3 anim-in">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
          Skills
        </span>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          {template ? (
            <>
              <span className="font-semibold text-foreground">
                {template.name}
              </span>{" "}
              ships with its bundled skills wired in. Add anything else this
              agent needs.
            </>
          ) : (
            "Pick the skills your agent should have. CLIs and credentials are layered in at boot."
          )}
        </p>
      </div>
      <div className="flex flex-col gap-4">
        {SKILL_CATALOG.map((category) => (
          <div key={category.key} className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
              {category.label}
            </span>
            <div className="flex flex-col gap-1.5">
              {category.items.map((item) => {
                const checked = selected.has(item.id);
                return (
                  <Label
                    key={item.id}
                    htmlFor={`skill-${item.id}`}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border bg-background px-3 py-2.5 cursor-pointer transition-colors",
                      checked
                        ? "border-primary bg-primary/5"
                        : "hover:border-foreground/30 hover:bg-muted/30",
                    )}
                  >
                    <input
                      id={`skill-${item.id}`}
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(item.id)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                    />
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="text-[13px] font-semibold text-foreground">
                        {item.name}
                      </span>
                      <span className="text-[12px] text-muted-foreground leading-snug">
                        {item.description}
                      </span>
                    </span>
                  </Label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Connections step for the scratch lane. Mirrors the connections page
 * (OAuth apps + MCP servers + secrets, each connectable inline) so a
 * user setting up a fresh agent can both create and grant new
 * connections without leaving the dialog. Granted = the connection's
 * underlying secret is selected on the agent's `selSecrets` list.
 */
function ScratchConnectionsStep({
  oauthAppEntries,
  availableToConnect,
  mcpSecrets,
  customSecrets,
  selSecretsSet,
  onToggleSecret,
  onConnectApp,
  onAddMcp,
  onAddSecret,
}: {
  oauthAppEntries: OAuthAppEntry[];
  availableToConnect: OAuthAppDescriptor[];
  mcpSecrets: { id: string; name: string }[];
  customSecrets: { id: string; name: string; hostPattern: string; pathPattern?: string }[];
  selSecretsSet: Set<string>;
  onToggleSecret: (id: string) => void;
  onConnectApp: (app: OAuthAppDescriptor) => void;
  onAddMcp: () => void;
  onAddSecret: () => void;
}) {
  return (
    <div className="flex flex-col gap-5 anim-in">
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
          Connections (optional)
        </span>
        <p className="text-[12px] text-muted-foreground leading-relaxed">
          Pick which credentials, MCP servers, and apps this agent can
          reach. Connect new ones inline — they'll be available
          platform-wide when you're done.
        </p>
      </div>

      {/* Apps */}
      <ConnectionsSection title="Apps">
        {oauthAppEntries.map((entry) => (
          <ConnectedRow
            key={entry.secretId}
            icon={
              <span className="text-foreground/80">
                <OAuthAppIcon appId={entry.appId} alt={entry.displayName} size={16} />
              </span>
            }
            label={entry.displayName}
            detail={entry.hostPattern}
            granted={selSecretsSet.has(entry.secretId)}
            expired={entry.expired}
            onToggleGrant={() => onToggleSecret(entry.secretId)}
          />
        ))}
        {availableToConnect.map((app) => (
          <AvailableRow
            key={app.id}
            icon={
              <span className="text-foreground/80">
                <OAuthAppIcon appId={app.id} alt={app.displayName} size={16} />
              </span>
            }
            label={app.displayName}
            description={app.description}
            onConnect={() => onConnectApp(app)}
          />
        ))}
      </ConnectionsSection>

      {/* MCP Servers */}
      <ConnectionsSection title="MCP Servers">
        {mcpSecrets.map((s) => (
          <ConnectedRow
            key={s.id}
            icon={<Globe size={16} className="text-foreground/80" />}
            label={mcpHostnameFromSecretName(s.name)}
            granted={selSecretsSet.has(s.id)}
            onToggleGrant={() => onToggleSecret(s.id)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onAddMcp}
        >
          <Plus size={14} /> Add MCP server
        </Button>
      </ConnectionsSection>

      {/* Secrets */}
      <ConnectionsSection title="Secrets">
        {customSecrets.map((s) => (
          <ConnectedRow
            key={s.id}
            icon={<Lock size={16} className="text-foreground/80" />}
            label={s.name}
            detail={
              s.pathPattern ? `${s.hostPattern}${s.pathPattern}` : s.hostPattern
            }
            granted={selSecretsSet.has(s.id)}
            onToggleGrant={() => onToggleSecret(s.id)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={onAddSecret}
        >
          <Plus size={14} /> Add Secret
        </Button>
      </ConnectionsSection>
    </div>
  );
}

function ConnectionsSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
        {title}
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

/** Already-connected resource — a checkbox toggles the agent's grant. */
function ConnectedRow({
  icon,
  label,
  detail,
  granted,
  expired,
  onToggleGrant,
}: {
  icon: React.ReactNode;
  label: string;
  detail?: string;
  granted: boolean;
  expired?: boolean;
  onToggleGrant: () => void;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-3 rounded-lg border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-primary",
        granted ? "border-primary bg-primary/10" : "border-border",
      )}
    >
      <input
        type="checkbox"
        checked={granted}
        onChange={onToggleGrant}
        className="h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">{label}</div>
        {detail && (
          <div className="text-[11px] font-mono text-muted-foreground truncate">
            {detail}
          </div>
        )}
      </div>
      <Badge
        variant={expired ? "destructive" : "secondary"}
        className="shrink-0 uppercase tracking-[0.03em]"
      >
        {expired ? "Expired" : "Connected"}
      </Badge>
    </label>
  );
}

/** Available-to-connect OAuth app — Connect button kicks off the OAuth flow. */
function AvailableRow({
  icon,
  label,
  description,
  onConnect,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3">
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">{label}</div>
        {description && (
          <div className="text-[11px] text-muted-foreground truncate">
            {description}
          </div>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onConnect}>
        Connect
      </Button>
    </div>
  );
}

/**
 * 3-lane starting-path picker. Frames agent creation as three distinct
 * journeys (vanilla harness / opinionated template / bring-your-own
 * image) instead of a flat list that mixes them. Colors echo the rich
 * empty-state palettes (aurora / sunset / forest) so the lanes read
 * consistently with the surrounding empty-state vocabulary.
 */
function LanePicker({ onPick }: { onPick: (lane: Lane) => void }) {
  return (
    <div className="flex flex-col gap-2 anim-in">
      <LaneCard
        lane="scratch"
        palette="aurora"
        icon={<DocumentAdd size={20} />}
        title="Start from scratch"
        description="Start with a simple harness, and build from there."
        onClick={() => onPick("scratch")}
      />
      <LaneCard
        lane="template"
        palette="sunset"
        icon={<Extensions size={20} />}
        title="Start from a template"
        description="Pre-configured agent with skills, prompts, and connections"
        onClick={() => onPick("template")}
      />
      <LaneCard
        lane="custom"
        palette="forest"
        icon={<Code size={20} />}
        title="Custom image"
        badge="Advanced"
        description="Bring your own ACP-compatible image — for harnesses you've built yourself."
        onClick={() => onPick("custom")}
      />
    </div>
  );
}

/**
 * Single lane row. The icon square uses a soft pastel gradient drawn
 * from the IBM Carbon color tokens at the 20-level (the same family
 * the empty-state cards and login backdrop sample, just at full
 * opacity instead of layered low-opacity blobs over white). Icons
 * render black on top — Carbon 20-tones have ample contrast with
 * black at the 40px square scale.
 */
// Carbon 10-level tones — the lightest tints in the palette, the same
// "barely-there" feel as the empty-state card backdrops. The empty-
// state's multi-blob recipe doesn't scale down to a 40px square, so
// we use a soft two-stop linear gradient between two adjacent 10-level
// hues from the same family instead. Reads as mostly one pale color,
// which is fine — the goal is a whisper of palette identity, not a
// statement.
const LANE_ICON_GRADIENT: Record<EmptyStatePalette, string> = {
  // Carbon Blue-10 → Purple-10
  aurora: "linear-gradient(135deg, #edf5ff 0%, #f6f2ff 100%)",
  // Carbon Orange-10 → Magenta-10
  sunset: "linear-gradient(135deg, #fff2e8 0%, #fff0f7 100%)",
  // Carbon Cyan-10 → Teal-10
  forest: "linear-gradient(135deg, #e5f6ff 0%, #d9fbfb 100%)",
};

function LaneCard({
  palette,
  icon,
  title,
  badge,
  description,
  onClick,
}: {
  lane: Lane;
  palette: EmptyStatePalette;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-lg border bg-background px-3 py-3 text-left",
        "transition-colors hover:border-foreground/30 hover:bg-muted/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-black"
        style={{ background: LANE_ICON_GRADIENT[palette] }}
        aria-hidden
      >
        {icon}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold text-foreground">
            {title}
          </span>
          {badge && (
            <span className="text-[10px] font-bold uppercase tracking-[0.05em] text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        <span className="text-[12px] text-muted-foreground leading-snug">
          {description}
        </span>
      </span>
      <ArrowRight
        size={16}
        className="text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  );
}

/**
 * Shared frame for a chosen lane's sub-picker. Provides the back link
 * to the lane picker plus a small headline + description that explains
 * what the user is selecting in this lane.
 */
function LaneFrame({
  title,
  description,
  onBack,
  children,
}: {
  title: string;
  description: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 anim-in">
      <button
        type="button"
        onClick={onBack}
        className="self-start inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft size={12} /> Choose a different starting path
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold text-foreground">
          {title}
        </span>
        <span className="text-[12px] text-muted-foreground leading-snug">
          {description}
        </span>
      </div>
      {children}
    </div>
  );
}
