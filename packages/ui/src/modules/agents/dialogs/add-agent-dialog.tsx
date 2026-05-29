import {
  Add as Plus,
  Checkmark,
  Code,
  DocumentAdd,
  Extensions,
  Folder,
} from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  AppConnectionView,
  ConnectionTemplateView,
  Skill as SkillItem,
  SkillSource,
} from "api-server-api";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder as FolderIcon,
  Upload,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

import { api } from "../../../api.js";
import type { EmptyStatePalette } from "../../../components/empty-state.js";
import { FormField } from "../../../components/form-field.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import {
  isProviderPresetType,
  PROVIDER_PRESET_TYPES,
  type ProviderPresetType,
  PROVIDERS,
} from "../../../types.js";
import {
  useAppConnections,
  useConnectionTemplates,
} from "../../connections/api/queries.js";
import { OAuthAppIcon } from "../../connections/components/oauth-app-icon.js";
import { TemplateCreateForm } from "../../connections/forms/template-create-form.js";
import {
  type BundleEntry,
  filterImportEntries,
  isTarballName,
  walkDataTransfer,
} from "../../files/api/import-bundle.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { PROVIDER_CARDS } from "../../settings/components/provider-cards.js";
import {
  addAgentSchema,
  type AddAgentValues,
} from "../forms/add-agent-schema.js";

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
  | "browse"
  | "setup"
  | "connections"
  | "skills";

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

export function AddAgentDialog({
  templates,
  onSubmit,
  onCancel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
  // Wizard kicks off on the provider step — picking a provider (or
  // skipping it) is the first decision the user makes, since an agent
  // can't reach a model without one. From there, the lane picker
  // ("pick") frames the three starting paths.
  const [step, setStep] = useState<Step>("provider");
  const [lane, setLane] = useState<Lane | null>(null);
  const [pendingLane, setPendingLane] = useState<Lane | null>(null);
  const [pendingAgentTemplate, setPendingAgentTemplate] =
    useState<AgentTemplate | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(
    null,
  );
  // Distinct from `selectedTemplate` (which is a harness TemplateView).
  // This holds the opinionated AGENT_TEMPLATES preset the user picked on
  // the browse step — used to drive prefilling, required-connection
  // gating, and pre-checked skills throughout the rest of the wizard.
  const [selectedAgentTemplate, setSelectedAgentTemplate] =
    useState<AgentTemplate | null>(null);
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
    const { kept } = filterImportEntries(incoming);
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
      return;
    }
    appendEntries(incoming);
  };

  const { data: secrets = [] } = useSecrets();
  const { data: apps = [] } = useAppConnections();
  const { data: connectionTemplates = [] } = useConnectionTemplates();
  // Prefer the real backend template when available (lets the OAuth
  // handshake actually fire); fall back to a synthetic descriptor so
  // the button is still visible during design iteration / when the
  // cluster is offline.
  const githubTemplate = connectionTemplates.find((t) => t.id === "github") ?? {
    id: "github",
    name: "GitHub",
    category: "app" as const,
    isCustom: false,
    description: "Read + write GitHub repos, issues, PRs.",
    iconSlug: "github",
    authKind: "oauth" as const,
    // Mirrors inputsFor() in api-server when Helm has clientId / clientSecret /
    // appSlug configured — keeps "Customize defaults" populated when the real
    // template isn't available yet.
    inputs: [
      {
        name: "clientId",
        state: "overridable" as const,
        presetValue: "Iv1.mock-client-id",
      },
      {
        name: "clientSecret",
        state: "overridable" as const,
        secret: true,
      },
      {
        name: "appSlug",
        state: "overridable" as const,
        presetValue: "platform-mock",
      },
    ],
  };
  const [showGithubConnect, setShowGithubConnect] = useState(false);

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
  const selSecrets = watch("selSecrets");
  const selSecretsSet = useMemo(() => new Set(selSecrets), [selSecrets]);

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
    setStep("setup");
  };

  // Wizard nav. `next` validates the leaving step's required fields
  // before advancing; `back` is unconditional and rewinds to the prior
  // step (or all the way back to the lane picker from the first
  // post-lane step). The template lane shares the scratch lane's
  // setup → connections → skills → submit shape; the only difference
  // is an extra `browse` step at the front. The provider step sits
  // at the very front of the wizard — picking (or skipping) a provider
  // is what unlocks the lane picker.
  const goNext = async () => {
    if (step === "provider") {
      setStep("pick");
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
      // All lanes end at skills — Create agent button renders there.
    }
  };
  const goBack = () => {
    if (step === "provider") {
      // Provider is the first step — Back closes the dialog, same as
      // Cancel. Surfaced as Cancel in the footer.
      onCancel();
    } else if (step === "pick") {
      // Lane picker — Back returns to the provider step. Lane sub-pickers
      // (custom image input) clear the lane in their own back affordance
      // via LaneFrame's "Choose a different starting path" link.
      setStep("provider");
      setLane(null);
    } else if (step === "browse") {
      setStep("pick");
      setLane(null);
      setSelectedAgentTemplate(null);
      setSelectedTemplate(null);
    } else if (step === "setup") {
      if (lane === "template") {
        setStep("browse");
      } else {
        setStep("pick");
        setLane(null);
        setSelectedTemplate(null);
      }
    } else if (step === "connections") {
      setStep("setup");
    } else if (step === "skills") {
      setStep("connections");
    }
  };

  // Lane pick handler. Scratch jumps straight to the consolidated
  // setup step with the first available template auto-selected as the
  // default harness — the user picks the harness via segmented buttons
  // on that step rather than a separate card list. Template lane goes
  // to the browse step so the user can pick an opinionated preset
  // first.
  const handleLanePick = (l: Lane) => {
    setLane(l);
    if (l === "scratch") {
      if (templates.length > 0) {
        setSelectedTemplate(templates[0]);
      }
      setStep("setup");
    } else if (l === "template") {
      setStep("browse");
    }
  };

  const pickHarness = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
  };

  // Picking an opinionated agent template from the browse step.
  // Resolves the template's harness hint against the live harness
  // catalog (so the resulting agent is bound to the right image),
  // pre-fills name + description on the form, and advances to setup.
  const pickAgentTemplate = (tmpl: AgentTemplate) => {
    setSelectedAgentTemplate(tmpl);
    const harness =
      templates.find((t) =>
        t.id.toLowerCase().includes(tmpl.harnessHint.toLowerCase()),
      ) ??
      templates.find((t) =>
        t.name.toLowerCase().includes(tmpl.harnessHint.toLowerCase()),
      ) ??
      templates[0] ??
      null;
    setSelectedTemplate(harness);
    setValue("name", tmpl.defaultName);
    setValue("description", tmpl.defaultDescription);
    trigger();
    setStep("setup");
  };

  const submitForm = handleSubmit((values) => {
    // Guard: the form's submit can fire from any button without an explicit
    // type=button (the shadcn Button passes through but doesn't default), or
    // from Enter pressed in an inner input. We only want submit to fire from
    // the final step's "Create agent" click — anything earlier is a bug, and
    // silently swallowing it preserves the user's place in the wizard.
    if (step !== "skills") return;
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
    () => new Set(providerSecrets.map((s) => s.type as ProviderPresetType)),
    // Identity reuse — the Set rebuilds only when the provider list itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [providerSecrets.map((s) => s.id).join("|")],
  );

  // Inline provider setup — picking a preset from the dropdown's "Set up
  // new" group shows that preset's card form right below the field.
  // After the user saves a key, the secret list refetches; this effect
  // notices the type now has a configured secret and closes the setup
  // card.
  const [pickedProvider, setPickedProvider] =
    useState<ProviderPresetType | null>(null);

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
    const otherProviderIds = providerSecrets
      .map((p) => p.id)
      .filter((id) => id !== secretId);
    const next = selSecretsArr.filter((id) => !otherProviderIds.includes(id));
    if (!next.includes(secretId)) next.push(secretId);
    setValue("selSecrets", next.sort(), {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && onCancel()}>
        <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {step === "provider"
                ? "Pick a provider"
                : step === "pick" && lane === "custom"
                  ? "Custom image"
                  : step === "browse"
                    ? "Browse template catalog"
                    : step === "connections"
                      ? "Add connections"
                      : step === "skills"
                        ? "Add skills"
                        : step === "setup"
                          ? "Set up your agent"
                          : "Add Agent"}
            </DialogTitle>
            {step === "provider" && (
              <DialogDescription>
                Pick (or set up) the provider this agent will use to reach a
                model. An agent can't run without one.
              </DialogDescription>
            )}
            {step === "pick" && lane === null && (
              <DialogDescription>
                Choose how you want to start
              </DialogDescription>
            )}
            {step === "pick" && lane === "custom" && (
              <DialogDescription>
                Bring your own ACP-compatible agent image — for harnesses
                you've built or specialized runtimes that need bundled CLIs.
              </DialogDescription>
            )}
            {step === "connections" && (
              <DialogDescription>
                Pick which credentials, apps, and MCP servers this agent can
                reach
              </DialogDescription>
            )}
            {step === "skills" && (
              <DialogDescription>
                Pick which skills this agent should ship with — or add a new
                source.
              </DialogDescription>
            )}
          </DialogHeader>

          {/* Lane picker → wizard. The provider chooser used to live at
            the top of the dialog; it now sits in its own wizard step
            (with a Skip-for-now affordance) so the lane decision can
            be made first and provider isn't a blocking gate. */}

          {step === "pick" ? (
            lane === null ? (
              <>
                <LanePicker selected={pendingLane} onSelect={setPendingLane} />
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={goBack}>
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button
                    type="button"
                    disabled={!pendingLane}
                    onClick={() => {
                      if (pendingLane) handleLanePick(pendingLane);
                    }}
                  >
                    Continue <ArrowRight size={14} />
                  </Button>
                </DialogFooter>
              </>
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
                    No harnesses available. Check your cluster's agent template
                    configuration.
                  </p>
                )}
              </LaneFrame>
            ) : lane === "template" ? null : (
              <>
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
                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setLane(null);
                      setCustomImage("");
                    }}
                  >
                    <ArrowLeft size={14} /> Back
                  </Button>
                  <Button
                    type="button"
                    onClick={pickCustom}
                    disabled={!customImage.trim()}
                  >
                    Continue <ArrowRight size={14} />
                  </Button>
                </DialogFooter>
              </>
            )
          ) : step === "provider" ||
            step === "browse" ||
            step === "setup" ||
            (step === "connections" || step === "skills") ? null : (
            <>
              {/* Persistent image readout — shown on most non-pick,
                  non-setup steps so the user can always see what
                  they're configuring against. The setup step has its
                  own harness picker, so the readout would be redundant
                  there. The scratch lane also hides it on connections
                  and skills since the user just confirmed the harness
                  on the setup step right before. */}
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
                        <span className="font-mono">
                          {selectedTemplate.image}
                        </span>
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

          {/* Browse step — template lane only. Sits OUTSIDE the agent
              form so a click on a card can't bubble into a stray
              submit; advancing to setup is what mounts the form. */}
          {step === "browse" && (
            <>
              <BrowseTemplatesStep
                selected={pendingAgentTemplate}
                onSelect={setPendingAgentTemplate}
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={goBack}>
                  <ArrowLeft size={14} />
                  Back
                </Button>
                <Button
                  type="button"
                  disabled={!pendingAgentTemplate}
                  onClick={() => {
                    if (pendingAgentTemplate)
                      pickAgentTemplate(pendingAgentTemplate);
                  }}
                >
                  Continue <ArrowRight size={14} />
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Provider step — sits OUTSIDE the agent form because the
              inline provider setup card renders its own nested <form>,
              and HTML doesn't allow form nesting. The user must pick or
              set up a provider before continuing — an agent can't reach
              a model without one. */}
          {step === "provider" && (
            <fieldset className="flex flex-col gap-3 anim-in">
              <ProviderPickerSection
                providerSecrets={providerSecrets}
                picked={pickedProvider}
                onPick={setPickedProvider}
                selectedProviderSecretId={selectedProviderSecretId}
                onSelectProviderSecret={setSelectedProviderSecret}
              />
            </fieldset>
          )}

          {/* Single <form> wrapping the wizard's input steps.
              Sections render conditionally per step but the underlying
              react-hook-form state is shared, so values persist as the
              user moves Back/Next. The form is scoped here so a save in
              the provider's setup form (rendered on the provider step
              above) doesn't bubble up and submit the agent. */}
          {(step === "setup" ||
            step === "basics" ||
            step === "connections" ||
            step === "skills") && (
            <form onSubmit={submitForm} className="contents">
              {(step === "basics" || step === "setup") && (
                <>
                  <FormField label="Name" error={errors.name?.message}>
                    <Input
                      placeholder="my-agent"
                      autoFocus
                      {...register("name")}
                    />
                  </FormField>
                  <FormField label="Description (optional)">
                    <Input
                      placeholder="What does this agent do?"
                      {...register("description")}
                    />
                  </FormField>

                  {/* Harness picker — scratch lane only. Template lane
                      binds the harness implicitly via the agent template
                      preset, so showing the picker here would let the
                      user pick something the template wasn't designed
                      for. */}
                  {step === "setup" && lane === "scratch" && (
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
                          No harnesses available. Check your cluster's agent
                          template configuration.
                        </p>
                      )}
                    </FormField>
                  )}

                  {step === "basics" && (
                    <FormField label="Starting source">
                      <RadioGroup
                        value={startingSource}
                        onValueChange={(v) =>
                          setStartingSource(v as StartingSource)
                        }
                        className="flex flex-col gap-1.5"
                      >
                        <Label
                          htmlFor="src-local"
                          className={cn(
                            "flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5",
                            startingSource === "local" && "border-primary",
                          )}
                        >
                          <RadioGroupItem
                            value="local"
                            id="src-local"
                            className="mt-0.5"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-[13px] font-semibold text-foreground">
                              Upload local files
                            </span>
                            <span className="text-[12px] text-muted-foreground">
                              Drop a folder, files, or a{" "}
                              <code className="font-mono">.tar.gz</code> bundle
                              to seed the agent's workspace.
                            </span>
                          </span>
                        </Label>
                        <Label
                          htmlFor="src-github"
                          className={cn(
                            "flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5",
                            startingSource === "github" && "border-primary",
                          )}
                        >
                          <RadioGroupItem
                            value="github"
                            id="src-github"
                            className="mt-0.5"
                          />
                          <span className="flex flex-col gap-0.5">
                            <span className="text-[13px] font-semibold text-foreground">
                              Clone a GitHub repo
                            </span>
                            <span className="text-[12px] text-muted-foreground">
                              Agent boots with your repo cloned into{" "}
                              <code className="font-mono">/workspace</code>,
                              credentials sourced from a connection.
                            </span>
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
                            Prototype: the URL is captured but the controller
                            doesn't yet clone — devs, see the related issue.
                          </span>
                        </div>
                      )}
                    </FormField>
                  )}

                  {((step === "basics" && startingSource === "local") ||
                    step === "setup") && (
                    <FormField label="Import context">
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
                            Array.from(files).map((f) => ({
                              path: f.name,
                              file: f,
                            })),
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
                          if (
                            e.currentTarget.contains(
                              e.relatedTarget as Node | null,
                            )
                          )
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
                            ? "border-foreground"
                            : "border-border hover:border-foreground/30",
                        )}
                      >
                        <Upload size={28} className="text-muted-foreground" />
                        <div className="text-[13px] text-foreground">
                          Drop a folder or files here
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <code className="font-mono">.tar.gz</code> bundles
                          pass through verbatim
                        </div>
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              importFolderInputRef.current?.click()
                            }
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
                          {githubTemplate && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => setShowGithubConnect(true)}
                            >
                              <OAuthAppIcon
                                appId="github"
                                alt="GitHub"
                                size={14}
                              />{" "}
                              Connect GitHub
                            </Button>
                          )}
                        </div>
                        {(importRawBundle || importEntries.length > 0) && (
                          <div className="w-full flex flex-col gap-1.5 mt-2">
                            {importRawBundle ? (
                              <ImportFileRow
                                name={importRawBundle.name}
                                isFolder={false}
                                onRemove={() => setImportRawBundle(null)}
                              />
                            ) : (
                              importGroups.map((g) => (
                                <ImportFileRow
                                  key={g.name}
                                  name={g.name}
                                  isFolder={g.isFolder}
                                  count={g.isFolder ? g.count : undefined}
                                  onRemove={() => removeGroup(g.name)}
                                />
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    </FormField>
                  )}
                </>
              )}

              {step === "connections" && (
                  <ScratchConnectionsStep
                    templates={connectionTemplates}
                    connections={apps as unknown as AppConnectionView[]}
                    selSecretsSet={selSecretsSet}
                    onToggleSecret={toggleSecret}
                    requiredConnectionIds={
                      lane === "template"
                        ? (selectedAgentTemplate?.requiredConnectionIds ?? [])
                        : []
                    }
                  />
                )}

              {step === "skills" && (
                <SkillsCatalogStep
                  selected={selectedSkills}
                  onToggle={toggleSkill}
                  preselectedSkillNames={
                    lane === "template"
                      ? (selectedAgentTemplate?.preselectedSkills ?? [])
                      : []
                  }
                  templateBundledSkills={
                    lane === "template"
                      ? (selectedAgentTemplate?.bundledSkills ?? [])
                      : []
                  }
                />
              )}

              {step === "setup" && (
                <fieldset className="flex flex-col gap-2">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                    Network access
                  </span>
                  <p className="text-[12px] text-muted-foreground">
                    Initial set of hosts the agent can reach. Anything not
                    covered surfaces in the inbox; you can change this later
                    from the agent's Network access tab.
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
                      <RadioGroupItem
                        value="trusted"
                        id="egress-trusted"
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-foreground">
                          Trusted defaults (recommended)
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          npm, PyPI, GitHub, package mirrors, Anthropic
                        </span>
                      </span>
                    </Label>
                    <Label
                      htmlFor="egress-none"
                      className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5"
                    >
                      <RadioGroupItem
                        value="none"
                        id="egress-none"
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-foreground">
                          Strict default-deny
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          Every host hits the inbox until you approve
                        </span>
                      </span>
                    </Label>
                    <Label
                      htmlFor="egress-all"
                      className="flex items-start gap-2 cursor-pointer rounded-lg border border-warning/40 bg-background px-4 py-2.5"
                    >
                      <RadioGroupItem
                        value="all"
                        id="egress-all"
                        className="mt-0.5"
                      />
                      <span className="flex flex-col gap-0.5">
                        <span className="text-[13px] font-semibold text-foreground">
                          Allow everything
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          Development escape hatch — no inbox prompts
                        </span>
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
                {/* Single, always-type=button primary action. We previously
                    swapped between type="button" Next and type="submit"
                    Create — when Next's setStep re-rendered the button
                    between mousedown and mouseup, the click landed on the
                    now-submit Create button and the wizard skipped Skills
                    entirely. Routing both branches through onClick keeps the
                    submit gated behind the wizard's own state machine. */}
                {step === "skills" ? (
                  <Button
                    type="button"
                    onClick={() => void submitForm()}
                    disabled={isSubmitting || !isValid}
                  >
                    Create agent
                  </Button>
                ) : (
                  <Button type="button" onClick={goNext}>
                    {step === "setup" ? "Continue" : "Next"}{" "}
                    <ArrowRight size={14} />
                  </Button>
                )}
              </DialogFooter>
            </form>
          )}

          {step === "provider" && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={goNext}
                disabled={!selectedProviderSecretId}
                title={
                  !selectedProviderSecretId
                    ? "Pick or set up a provider to continue"
                    : undefined
                }
              >
                Next <ArrowRight size={14} />
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      {showGithubConnect && githubTemplate && (
        <TemplateCreateForm
          template={githubTemplate}
          onCreated={(connectionId) => {
            setShowGithubConnect(false);
            // Pre-grant the connection: the user just authorized GitHub as
            // context for this specific agent, so it should arrive on the
            // next step already checked.
            if (!selSecretsSet.has(connectionId)) toggleSecret(connectionId);
          }}
          onCancel={() => setShowGithubConnect(false)}
        />
      )}
    </>
  );
}

/**
 * Provider picker — card list mirroring {@link ProviderChooserList} on
 * the Providers page. Configured presets are selectable (clicking
 * promotes that secret to the agent's primary provider); not-yet-set-up
 * presets fire the inline setup card via `onPick`. One row per
 * `PROVIDER_PRESET_TYPES` entry so the same vocabulary surfaces here as
 * in the standalone chooser dialog.
 */
function ProviderPickerSection({
  providerSecrets,
  picked,
  onPick,
  selectedProviderSecretId,
  onSelectProviderSecret,
}: {
  providerSecrets: { id: string; name: string; type: string }[];
  picked: ProviderPresetType | null;
  onPick: (type: ProviderPresetType | null) => void;
  selectedProviderSecretId: string | null;
  onSelectProviderSecret: (secretId: string) => void;
}) {
  const PickedCard = picked ? PROVIDER_CARDS[picked] : null;

  const handleValueChange = (value: string) => {
    const existing = providerSecrets.find((s) => s.id === value);
    if (existing) {
      onSelectProviderSecret(existing.id);
      onPick(null);
    } else if ((PROVIDER_PRESET_TYPES as readonly string[]).includes(value)) {
      onPick(value as ProviderPresetType);
    }
  };

  const selectedValue =
    selectedProviderSecretId ??
    (picked && !providerSecrets.find((s) => s.type === picked) ? picked : "");

  return (
    <div className="flex flex-col gap-3">
      <Select value={selectedValue} onValueChange={handleValueChange}>
        <SelectTrigger>
          <SelectValue placeholder="Select a provider" />
        </SelectTrigger>
        <SelectContent>
          {providerSecrets.length > 0 && (
            <>
              {providerSecrets.map((s) => {
                const meta =
                  PROVIDERS[s.type as ProviderPresetType] ?? undefined;
                return (
                  <SelectItem key={s.id} value={s.id}>
                    <span className="flex items-center gap-2">
                      <span>{meta?.displayName ?? s.name}</span>
                      <Badge variant="secondary" className="gap-1 text-[10px]">
                        <Checkmark className="h-3 w-3" /> Connected
                      </Badge>
                    </span>
                  </SelectItem>
                );
              })}
            </>
          )}
          {PROVIDER_PRESET_TYPES.filter(
            (id) => !providerSecrets.some((s) => s.type === id),
          ).map((id) => (
            <SelectItem key={id} value={id}>
              {PROVIDERS[id].displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {PickedCard && (
        <div className="flex flex-col gap-3 anim-in">
          <PickedCard secret={undefined} />
        </div>
      )}
    </div>
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
 * Skills catalog step. Mirrors the chat-view {@link SkillsPanel} for
 * the agent-creation wizard: lists registered skill sources from the
 * api-server, scans each source for skills (public sources only —
 * private repos need a running agent to delegate through, which we
 * don't have yet at create time), and lets the user toggle skills on/off
 * as design intent. An "+Add skill source" affordance lets users wire in
 * a new public git repo inline so the catalog grows during creation.
 *
 * Selected keys are `source::name` and live in the dialog's local state
 * — submission doesn't yet pass them through to the controller (the spec
 * shape needs to land first), but the picker captures the user's choices
 * so the wireframe walkthrough is faithful.
 */
/**
 * Opinionated agent presets surfaced on the "Start from a template" lane.
 * Pure UI-side seed data — there's no backend "agent template" concept yet,
 * so each preset boils down to: harness hint + pre-filled name/description
 * + required/optional connection ids + skills to pre-check + skills bundled
 * with the agent. On submit the dialog assembles the same payload it would
 * for a from-scratch agent built with the same fields.
 *
 * `harnessHint` is matched against the live `templates` prop (TemplateView
 * by id) to pick the harness image. If the hint isn't installed, we leave
 * the harness unset and the agent gets created without one — same as
 * picking a custom image with no entry.
 *
 * `requiredConnectionIds` / `optionalConnectionIds` reference the
 * connection-template ids returned by `connections.listTemplates`
 * (e.g. "github", "gmail"). Required connections gate the wizard's
 * Continue button; optional ones are surfaced as suggested adds.
 */
type AgentTemplate = {
  id: string;
  name: string;
  description: string;
  readmeUrl: string;
  harnessHint: string;
  defaultName: string;
  defaultDescription: string;
  requiredConnectionIds: ReadonlyArray<string>;
  optionalConnectionIds: ReadonlyArray<string>;
  preselectedSkills: ReadonlyArray<string>;
  bundledSkills: ReadonlyArray<{ name: string; description: string }>;
};

const AGENT_TEMPLATES: ReadonlyArray<AgentTemplate> = [
  {
    id: "google-workspace",
    name: "Google Workspace",
    description: "Email + calendar + drive triage.",
    readmeUrl:
      "https://github.com/anthropics/agent-templates/tree/main/google-workspace",
    harnessHint: "claude-code",
    defaultName: "gw-agent",
    defaultDescription: "Triages inbox, agenda, and drive activity.",
    requiredConnectionIds: ["gmail", "google-drive"],
    optionalConnectionIds: ["github", "google-calendar"],
    preselectedSkills: ["gmail-triage", "calendar-agenda", "drive-manage"],
    bundledSkills: [
      {
        name: "inbox-summary",
        description:
          "Scan + categorize inbox, identify action items, surface unread threads worth answering.",
      },
    ],
  },
];

/**
 * Browse step for the template lane. Renders a vertical card list of
 * curated agent presets — picking one pre-fills the rest of the wizard.
 * The README link opens GitHub in a new tab; clicking the card body
 * advances to setup.
 */
function BrowseTemplatesStep({
  selected,
  onSelect,
}: {
  selected: AgentTemplate | null;
  onSelect: (tmpl: AgentTemplate) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-3 anim-in">
      <div className="flex flex-col gap-2">
        {AGENT_TEMPLATES.map((tmpl) => {
          const isSelected = selected?.id === tmpl.id;
          const requiredCount = tmpl.requiredConnectionIds.length;
          const bundledCount = tmpl.bundledSkills.length;
          return (
            <button
              key={tmpl.id}
              type="button"
              onClick={() => onSelect(tmpl)}
              className={cn(
                "group flex items-start gap-3 rounded-lg border bg-background px-4 py-3 text-left",
                "transition-colors hover:border-foreground/30 hover:bg-muted/30",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected && "border-foreground",
              )}
            >
              <span className="flex-1 min-w-0 flex flex-col gap-1">
                <span className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-semibold text-foreground">
                    {tmpl.name}
                  </span>
                  <a
                    href={tmpl.readmeUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  >
                    README ↗
                  </a>
                </span>
                <span className="text-[12px] text-muted-foreground leading-snug">
                  {tmpl.description}
                </span>
                <span className="flex flex-wrap items-center gap-1 mt-1">
                  {requiredCount > 0 && (
                    <Badge variant="secondary">
                      {requiredCount} connection
                      {requiredCount === 1 ? "" : "s"} required
                    </Badge>
                  )}
                  {bundledCount > 0 && (
                    <Badge variant="secondary">
                      {bundledCount} skill
                      {bundledCount === 1 ? "" : "s"} bundled
                    </Badge>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Skills shipped inside the platform-base image — installed at agent
 * boot, so they're guaranteed-present once the pod runs. Listed here
 * (rather than fetched) because the agent doesn't exist yet at
 * create time, so there's no pod filesystem to read.
 */
const BUNDLED_SKILLS: ReadonlyArray<{ name: string; description: string }> = [
  {
    name: "platform-schedules",
    description:
      "Required scheduler for any work that fires after the current turn ends — recurring, future one-offs, polls, reminders.",
  },
];

function BundledSkillsList({
  skills,
  heading,
}: {
  skills: ReadonlyArray<{ name: string; description: string }>;
  heading: string;
}) {
  if (skills.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
        {heading}
      </span>
      <div className="flex flex-col gap-1.5">
        {skills.map((skill) => (
          <div key={skill.name} className="flex items-start gap-2.5 py-1">
            <Checkmark
              size={14}
              className="mt-0.5 shrink-0 text-muted-foreground"
            />
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[13px] font-medium text-foreground">
                {skill.name}
              </span>
              <span className="text-[12px] text-muted-foreground leading-snug">
                {skill.description}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SkillsCatalogStep({
  selected,
  onToggle,
  preselectedSkillNames = [],
  templateBundledSkills = [],
}: {
  selected: Set<string>;
  onToggle: (key: string) => void;
  /** Skill names the picked agent template wants pre-checked. Matched
   *  by name once each catalog source's skills load. Names that never
   *  appear in any source (e.g. template-bundled skills shown in
   *  `templateBundledSkills`) are silently ignored — the read-only
   *  card already represents them. */
  preselectedSkillNames?: ReadonlyArray<string>;
  /** Read-only skills the agent template ships with regardless of
   *  catalog. Rendered as a "Your skills" card above the user-pickable
   *  catalog, mirroring the platform-base bundled card style. */
  templateBundledSkills?: ReadonlyArray<{ name: string; description: string }>;
}) {
  const [sources, setSources] = useState<SkillSource[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [skillsBySource, setSkillsBySource] = useState<
    Record<string, SkillItem[]>
  >({});
  const [errorBySource, setErrorBySource] = useState<Record<string, string>>(
    {},
  );
  const [loadingBySource, setLoadingBySource] = useState<
    Record<string, boolean>
  >({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ name: "", gitUrl: "" });
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const loadSkills = useCallback(async (sourceId: string) => {
    setLoadingBySource((l) => ({ ...l, [sourceId]: true }));
    setErrorBySource((e) => {
      const next = { ...e };
      delete next[sourceId];
      return next;
    });
    try {
      const list = await api.skills.list.query({ sourceId });
      setSkillsBySource((s) => ({
        ...s,
        [sourceId]: Array.isArray(list) ? list : [],
      }));
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message.replace(/\nplatform-cta:\S+/, "").trim()
          : "Failed to scan source";
      setErrorBySource((e) => ({ ...e, [sourceId]: msg }));
      setSkillsBySource((s) => ({ ...s, [sourceId]: [] }));
    } finally {
      setLoadingBySource((l) => ({ ...l, [sourceId]: false }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const srcs = await api.skills.sources.list.query();
        if (cancelled) return;
        setSources(Array.isArray(srcs) ? srcs : []);
      } catch {
        if (!cancelled) setSources([]);
      } finally {
        if (!cancelled) setLoadingSources(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy-scan visible sources. Curated sources (system / template-seeded)
  // start collapsed; user-added ones expand by default.
  useEffect(() => {
    for (const src of sources) {
      if (collapsed.has(src.id)) continue;
      if (
        skillsBySource[src.id] === undefined &&
        !loadingBySource[src.id] &&
        !errorBySource[src.id]
      ) {
        void loadSkills(src.id);
      }
    }
  }, [
    sources,
    collapsed,
    skillsBySource,
    loadingBySource,
    errorBySource,
    loadSkills,
  ]);

  // Seed default-collapsed for curated sources so a 50-skill catalog
  // doesn't wall off the wizard for a user who just wants a quick pick.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (sources.length === 0) return;
    seededRef.current = true;
    setCollapsed((prev) => {
      const next = new Set(prev);
      for (const s of sources) {
        if (s.system || s.fromTemplate) next.add(s.id);
      }
      return next;
    });
  }, [sources]);

  // Auto-check preselected skills when their source's catalog loads.
  // Matched once per (source, name) tuple via `preselectedAppliedRef`
  // — without that guard, a user who manually unchecks a preselected
  // skill would see it re-check on the next render. Skills with names
  // that never appear in any catalog (template-bundled built-ins) are
  // covered by `templateBundledSkills` separately.
  const preselectedAppliedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (preselectedSkillNames.length === 0) return;
    const wanted = new Set(preselectedSkillNames);
    for (const [sourceId, list] of Object.entries(skillsBySource)) {
      if (!list) continue;
      for (const skill of list) {
        if (!wanted.has(skill.name)) continue;
        const key = `${skill.source}::${skill.name}`;
        if (preselectedAppliedRef.current.has(key)) continue;
        preselectedAppliedRef.current.add(key);
        if (!selected.has(key)) onToggle(key);
      }
      // Reference sourceId so eslint knows it's covered — and so the
      // dependency tracker reruns after each source loads.
      void sourceId;
    }
  }, [skillsBySource, preselectedSkillNames, selected, onToggle]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addSource = async () => {
    const name = addForm.name.trim();
    const gitUrl = addForm.gitUrl.trim();
    if (!name || !gitUrl) return;
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await api.skills.sources.create.mutate({ name, gitUrl });
      setSources((s) => [...s, created]);
      setAddForm({ name: "", gitUrl: "" });
      setShowAdd(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add source");
    } finally {
      setAddBusy(false);
    }
  };

  const allBundled = [
    ...templateBundledSkills,
    ...BUNDLED_SKILLS,
  ];

  return (
    <fieldset className="flex flex-col gap-5 anim-in">
      <BundledSkillsList
        heading="Bundled with this agent"
        skills={allBundled}
      />

      {loadingSources ? (
        <p className="text-[12px] text-muted-foreground">Loading skills…</p>
      ) : sources.length === 0 && !showAdd ? null : (
        <div className="flex flex-col gap-3">
          {sources.map((src) => {
            const isCollapsed = collapsed.has(src.id);
            const list = skillsBySource[src.id] ?? [];
            const loading = !!loadingBySource[src.id];
            const error = errorBySource[src.id];
            return (
              <div key={src.id} className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleCollapse(src.id)}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-muted-foreground hover:text-foreground self-start"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? (
                    <ChevronRight size={13} />
                  ) : (
                    <ChevronDown size={13} />
                  )}
                  {src.name}
                </button>
                {!isCollapsed && (
                  <div className="flex flex-col gap-1.5 pl-1">
                    {loading && (
                      <p className="text-[12px] text-muted-foreground">
                        Scanning skills…
                      </p>
                    )}
                    {!loading && error && (
                      <p className="text-[12px] text-destructive">{error}</p>
                    )}
                    {!loading && !error && list.length === 0 && (
                      <p className="text-[12px] text-muted-foreground">
                        No skills in this source.
                      </p>
                    )}
                    {!loading &&
                      !error &&
                      list.map((skill) => {
                        const key = `${skill.source}::${skill.name}`;
                        const checked = selected.has(key);
                        return (
                          <Label
                            key={key}
                            htmlFor={`skill-${key}`}
                            className="flex items-start gap-2.5 py-1.5 cursor-pointer"
                          >
                            <input
                              id={`skill-${key}`}
                              type="checkbox"
                              checked={checked}
                              onChange={() => onToggle(key)}
                              className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
                            />
                            <span className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[13px] font-medium text-foreground">
                                {skill.name}
                              </span>
                              {skill.description && (
                                <span className="text-[12px] text-muted-foreground leading-snug">
                                  {skill.description}
                                </span>
                              )}
                            </span>
                          </Label>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAdd ? (
        <Card className="px-4 py-3 flex flex-col gap-3">
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
            Add skill source
          </div>
          <div className="flex flex-col gap-2">
            <Input
              placeholder='Name (e.g. "Apocohq Skills")'
              value={addForm.name}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, name: e.target.value }))
              }
            />
            <Input
              placeholder="https://github.com/apocohq/skills"
              value={addForm.gitUrl}
              onChange={(e) =>
                setAddForm((f) => ({ ...f, gitUrl: e.target.value }))
              }
              className="font-mono"
            />
            {addError && (
              <span className="text-[11px] text-destructive">{addError}</span>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setShowAdd(false);
                setAddError(null);
                setAddForm({ name: "", gitUrl: "" });
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={
                addBusy || !addForm.name.trim() || !addForm.gitUrl.trim()
              }
              onClick={addSource}
            >
              {addBusy ? "Adding…" : "Add source"}
            </Button>
          </div>
        </Card>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="self-start"
          onClick={() => setShowAdd(true)}
        >
          <Plus size={14} /> Add skill source
        </Button>
      )}
    </fieldset>
  );
}

/**
 * Connections step for the scratch lane. Mirrors the connections page
 * — existing connections at the top with grant checkboxes, then the
 * full template catalog beneath. Each category caps at 5 rows by
 * default with a "Show all" affordance so the wizard stays digestible
 * for users with a long list of templates installed. Picking a
 * template opens TemplateCreateForm in a stacked modal so the user
 * stays inside the agent flow.
 */
function ScratchConnectionsStep({
  templates,
  connections,
  selSecretsSet,
  onToggleSecret,
  requiredConnectionIds = [],
}: {
  templates: ConnectionTemplateView[];
  connections: AppConnectionView[];
  selSecretsSet: Set<string>;
  onToggleSecret: (id: string) => void;
  /** Connection-template ids the picked agent template needs before
   *  Continue unlocks. Each id maps to a row at the top of the
   *  catalog with a "Required" badge and (when not yet active) a
   *  Connect button that fires the same OAuth flow as the connections
   *  page. */
  requiredConnectionIds?: ReadonlyArray<string>;
}) {
  const [creating, setCreating] = useState<ConnectionTemplateView | null>(null);

  const visibleTemplates = templates.filter(
    (t) => !PROVIDER_PRESET_TEMPLATE_IDS.has(t.id),
  );
  const iconByTemplateId = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const t of templates) m.set(t.id, t.iconSlug);
    return m;
  }, [templates]);

  // Required templates are pulled out of the regular catalog and
  // surfaced in their own REQUIRED section. The remainder still
  // groups into APPS / MCP / OTHER as usual.
  const requiredSet = useMemo(
    () => new Set(requiredConnectionIds),
    [requiredConnectionIds],
  );

  const requiredTemplates = useMemo(
    () =>
      requiredConnectionIds
        .map((id) => visibleTemplates.find((t) => t.id === id))
        .filter((t): t is ConnectionTemplateView => Boolean(t)),
    [requiredConnectionIds, visibleTemplates],
  );

  const grouped = useMemo(() => {
    const m = new Map<
      ConnectionTemplateView["category"],
      ConnectionTemplateView[]
    >();
    for (const t of visibleTemplates) {
      if (requiredSet.has(t.id)) continue;
      const list = m.get(t.category) ?? [];
      list.push(t);
      m.set(t.category, list);
    }
    return m;
  }, [visibleTemplates, requiredSet]);

  // Pending OAuth records are dropped here for the same reason as the
  // connections page — until the handshake completes there's no usable
  // credential to grant the agent, so showing it would mislead.
  const visibleConnections = connections.filter((c) => c.status !== "pending");

  // Active connections by templateId — used to short-circuit the
  // Required section's "Connect" affordance once the user has wired up
  // the matching template.
  const activeByTemplateId = useMemo(() => {
    const m = new Map<string, AppConnectionView>();
    for (const c of visibleConnections) {
      if (c.status === "active") m.set(c.templateId, c);
    }
    return m;
  }, [visibleConnections]);

  return (
    <>
      <div className="flex flex-col gap-5 anim-in">
        {requiredTemplates.length > 0 && (
          <ConnectionsSection title="Required">
            {requiredTemplates.map((t) => {
              const active = activeByTemplateId.get(t.id);
              if (active) {
                return (
                  <ConnectedRow
                    key={t.id}
                    icon={
                      <span className="text-foreground/80">
                        <OAuthAppIcon
                          appId={iconByTemplateId.get(t.id) ?? t.id}
                          alt={t.name}
                          size={16}
                        />
                      </span>
                    }
                    label={t.name}
                    detail="Required by template"
                    granted={selSecretsSet.has(active.id)}
                    onToggleGrant={() => onToggleSecret(active.id)}
                  />
                );
              }
              return (
                <RequiredTemplateRow
                  key={t.id}
                  template={t}
                  iconSlug={iconByTemplateId.get(t.id)}
                  onConnect={() => setCreating(t)}
                />
              );
            })}
          </ConnectionsSection>
        )}

        {visibleConnections.length > 0 && (
          <ConnectionsSection title="Your Connections">
            {visibleConnections
              .filter((c) => !requiredSet.has(c.templateId))
              .map((c) => (
                <ConnectedRow
                  key={c.id}
                  icon={
                    <span className="text-foreground/80">
                      <OAuthAppIcon
                        appId={
                          iconByTemplateId.get(c.templateId) ?? c.templateId
                        }
                        alt={c.name}
                        size={16}
                      />
                    </span>
                  }
                  label={c.name}
                  detail={c.hosts.join(", ") || c.templateId}
                  granted={selSecretsSet.has(c.id)}
                  onToggleGrant={() => onToggleSecret(c.id)}
                />
              ))}
          </ConnectionsSection>
        )}

        {(["app", "mcp", "other"] as const).map((cat) => {
          const list = grouped.get(cat) ?? [];
          if (list.length === 0) return null;
          return (
            <CategoryCatalog
              key={cat}
              title={categoryLabel(cat)}
              templates={list}
              onPick={(t) => setCreating(t)}
            />
          );
        })}
      </div>

      {creating && (
        <TemplateCreateForm
          template={creating}
          onCreated={() => setCreating(null)}
          onCancel={() => setCreating(null)}
        />
      )}
    </>
  );
}

function RequiredTemplateRow({
  template,
  iconSlug,
  onConnect,
}: {
  template: ConnectionTemplateView;
  iconSlug: string | undefined;
  onConnect: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-warning/40 bg-warning/5">
      <span className="text-foreground/80 shrink-0">
        <OAuthAppIcon
          appId={iconSlug ?? template.id}
          alt={template.name}
          size={16}
        />
      </span>
      <span className="flex-1 min-w-0 flex flex-col">
        <span className="text-[13px] font-semibold text-foreground truncate">
          {template.name}
        </span>
        {template.description && (
          <span className="text-[11px] text-muted-foreground truncate">
            {template.description}
          </span>
        )}
      </span>
      <Button type="button" size="sm" onClick={onConnect}>
        Connect
      </Button>
    </div>
  );
}

const PROVIDER_PRESET_TEMPLATE_IDS = new Set<string>(PROVIDER_PRESET_TYPES);

function categoryLabel(c: ConnectionTemplateView["category"]): string {
  return c === "app" ? "Apps" : c === "mcp" ? "MCP Servers" : "Custom";
}

/**
 * Category catalog with the 5-and-expand pattern. The first 5 entries
 * are always visible; anything past that lives behind a "Show all"
 * toggle. The grid scrolls inside its own viewport once expanded so
 * the wizard's outer scroll position stays put.
 */
function CategoryCatalog({
  title,
  templates,
  onPick,
}: {
  title: string;
  templates: ConnectionTemplateView[];
  onPick: (t: ConnectionTemplateView) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const showToggle = templates.length > 5;
  const visible = expanded ? templates : templates.slice(0, 5);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
          {title}
        </span>
        {showToggle && (
          <span className="text-[10px] text-muted-foreground">
            {expanded ? templates.length : `5 of ${templates.length}`}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((t) => (
          <Card
            key={t.id}
            onClick={() => onPick(t)}
            className="group cursor-pointer py-3 px-4 flex flex-row items-start gap-3 transition-shadow hover:shadow-md"
          >
            <span className="shrink-0 mt-0.5 text-foreground/80">
              <OAuthAppIcon appId={t.iconSlug ?? t.id} alt={t.name} size={16} />
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold text-foreground transition-colors group-hover:text-primary">
                {t.name}
              </div>
              {t.description && (
                <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                  {t.description}
                </div>
              )}
            </div>
          </Card>
        ))}
      </div>
      {showToggle && (
        <Button
          type="button"
          variant="link"
          size="sm"
          className="self-start px-0 h-auto"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? "Show fewer" : `Show all (${templates.length})`}
        </Button>
      )}
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
    <label className="flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 cursor-pointer transition-colors hover:border-foreground/30">
      <input
        type="checkbox"
        checked={granted}
        onChange={onToggleGrant}
        className="h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-foreground truncate">
          {label}
        </div>
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

/**
 * One row inside the import drop area — replaces the small chip that
 * used to sit beneath the drop zone. Full-width row with a clear icon,
 * the entry name, optional count for folders, and a remove button.
 * Living inside the dashed surface anchors selection state to the same
 * focal element instead of sending the eye to a tiny pill below.
 */
function ImportFileRow({
  name,
  isFolder,
  count,
  onRemove,
}: {
  name: string;
  isFolder: boolean;
  count?: number;
  onRemove: () => void;
}) {
  const Icon = isFolder ? FolderIcon : FileIcon;
  return (
    <div className="flex items-center gap-2.5 rounded-md border bg-background px-3 py-2 text-left">
      <Icon size={14} className="text-muted-foreground shrink-0" />
      <span
        className="text-[13px] text-foreground truncate flex-1 text-left"
        title={name}
      >
        {name}
      </span>
      {count !== undefined && (
        <span className="text-[11px] text-muted-foreground shrink-0">
          {count} {count === 1 ? "file" : "files"}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:text-foreground shrink-0"
        aria-label={`Remove ${name}`}
      >
        <X size={14} />
      </button>
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
function LanePicker({
  selected,
  onSelect,
}: {
  selected: Lane | null;
  onSelect: (lane: Lane) => void;
}) {
  return (
    <div className="flex flex-col gap-2 anim-in">
      <LaneCard
        lane="scratch"
        palette="aurora"
        icon={<DocumentAdd size={20} />}
        title="Start from scratch"
        description="Start with a simple harness, and build from there."
        selected={selected === "scratch"}
        onClick={() => onSelect("scratch")}
      />
      <LaneCard
        lane="template"
        palette="sunset"
        icon={<Extensions size={20} />}
        title="Start from a template"
        description="Pre-configured agent with skills, prompts, and connections"
        selected={selected === "template"}
        onClick={() => onSelect("template")}
      />
      <LaneCard
        lane="custom"
        palette="forest"
        icon={<Code size={20} />}
        title="Custom image"
        badge="Advanced"
        description="Bring your own ACP-compatible image — for harnesses you've built yourself."
        selected={selected === "custom"}
        onClick={() => onSelect("custom")}
      />
    </div>
  );
}

/**
 * Single lane row. Icon square uses the `secondary` token so the chip
 * blends with the surrounding card surface without claiming any
 * palette identity. `palette` is retained on the type for symmetry
 * with the empty states but no longer drives the swatch color.
 */
const LANE_ICON_GRADIENT: Record<EmptyStatePalette, string> = {
  aurora:
    "linear-gradient(135deg, rgba(120, 169, 255, 0.35), rgba(190, 149, 255, 0.35))",
  sunset:
    "linear-gradient(135deg, rgba(255, 174, 107, 0.35), rgba(255, 131, 137, 0.35))",
  forest:
    "linear-gradient(135deg, rgba(130, 207, 255, 0.35), rgba(8, 189, 186, 0.35))",
};

function LaneCard({
  palette,
  icon,
  title,
  badge,
  description,
  selected,
  onClick,
}: {
  lane: Lane;
  palette: EmptyStatePalette;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  description: string;
  selected?: boolean;
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
        selected && "border-foreground",
      )}
    >
      <span
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground"
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
