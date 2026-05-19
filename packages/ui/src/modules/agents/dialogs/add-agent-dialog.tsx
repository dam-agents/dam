import { Checkmark } from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import * as SelectPrimitive from "@radix-ui/react-select";
import { File as FileIcon, Folder as FolderIcon, FolderUp, Upload, X } from "lucide-react";
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
import { FormField } from "../../../components/form-field.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import {
  APP_OAUTH_SECRET_PREFIX,
  isProviderPresetType,
  PROVIDER_PRESET_TYPES,
  type ProviderPresetType,
  PROVIDERS,
} from "../../../types.js";
import {
  useAppConnections,
  useOAuthAppConnections,
} from "../../connections/api/queries.js";
import { type BundleEntry, filterImportEntries, isTarballName, walkDataTransfer } from "../../files/api/import-bundle.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { PROVIDER_CARDS } from "../../settings/components/provider-cards.js";
import { PROVIDER_DESCRIPTIONS } from "../../settings/components/provider-chooser-dialog.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";
import { addAgentSchema, type AddAgentValues } from "../forms/add-agent-schema.js";

type Step = "pick" | "configure";

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
  const importFolderInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const appendEntries = (incoming: BundleEntry[]) => {
    const { kept, dropped } = filterImportEntries(incoming);
    setImportEntries((prev) => {
      // If we were in pass-through mode, the user is now building a
      // multi-file import — fold the raw bundle in as a regular file so
      // it's still included.
      const base = importRawBundle && prev.length === 0
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
      incoming.length === 1
      && isTarballName(incoming[0].path)
      && !incoming[0].path.includes("/")
      && importEntries.length === 0
      && !importRawBundle
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
    defaultValues: { name: "", description: "", selSecrets: [], selApps: [], egressPreset: "trusted" },
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
  const oauthAppEntries = useMemo<OAuthAppEntry[]>(() => {
    const secretByName = new Map(secrets.map((s) => [s.name, s]));
    return oauthAppConnections.flatMap((conn) => {
      const mirror = secretByName.get(`${APP_OAUTH_SECRET_PREFIX}${conn.connectionId}`);
      if (!mirror) return [];
      return [{
        secretId: mirror.id,
        appId: conn.appId,
        displayName: conn.displayName,
        hostPattern: conn.hostPattern,
        expired: conn.expired,
      }];
    });
  }, [oauthAppConnections, secrets]);

  const pickTemplate = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
    setValue("name", tmpl.name);
    setValue("description", tmpl.description ?? "");
    // Force validation so isValid reflects the prefilled template values —
    // setValue defaults to skipping it and the user might submit without ever
    // typing in the field.
    trigger();
    setStep("configure");
  };

  const pickCustom = () => {
    const img = customImage.trim();
    if (!img) return;
    setSelectedTemplate(null);
    setValue("name", "");
    setValue("description", "");
    trigger();
    setStep("configure");
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

  // Gate the template/custom-image pick on having a provider in hand —
  // either previously configured (and selected) or just-saved through the
  // inline chooser.
  const hasProviderReady = providerSecrets.length > 0 && selectedProviderSecretId != null;

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Agent</DialogTitle>
          <DialogDescription>
            Pick the provider this agent will use, then choose a template
            or supply a custom image.
          </DialogDescription>
        </DialogHeader>

        {/* No outer <form> here — the provider setup card renders its own
            <form>, and nested forms in HTML get flattened (a submit on the
            inner form bubbles up and submits the outer one, dismissing the
            agent dialog). The configure-step fields below get their own
            <form> so submission stays scoped. */}

        {/* Provider — always at the top. Required before template/image
            pick: an agent without a provider can't reach a model. When
            the user already has providers configured, this is a dropdown
            to select which one this agent should use; otherwise it
            renders the chooser inline so they can set one up here. */}
        <ProviderPickerSection
            providerSecrets={providerSecrets}
            configuredTypes={configuredProviderTypes}
            picked={pickedProvider}
            onPick={setPickedProvider}
            selectedProviderSecretId={selectedProviderSecretId}
            onSelectProviderSecret={setSelectedProviderSecret}
          />

          {/* Image — same slot in both states. Renders the picker when
              nothing's been chosen yet; collapses to a single read-only
              row once the user picks, with a "Change" button to revisit
              the picker without rearranging anything else. */}
          {step === "pick" ? (
            hasProviderReady ? (
              <>
                {templates.length > 0 && (
                  <FormField label="Template">
                    <Select
                      value=""
                      onValueChange={(id) => {
                        const tmpl = templates.find((t) => t.id === id);
                        if (tmpl) pickTemplate(tmpl);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Pick a template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map((tmpl) => (
                          <SelectItem key={tmpl.id} value={tmpl.id}>
                            <span className="flex flex-col">
                              <span className="text-[14px] font-medium">{tmpl.name}</span>
                              {tmpl.description && (
                                <span className="text-[12px] text-muted-foreground">{tmpl.description}</span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                )}

                <FormField label="Or use a custom image">
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
                </FormField>
              </>
            ) : (
              <p className="text-[12px] text-muted-foreground">
                Add a provider above to continue.
              </p>
            )
          ) : (
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
                  onClick={() => setStep("pick")}
                >
                  Change
                </Button>
              </div>
            </FormField>
          )}

          {/* Configuration fields appear below once an image is chosen.
              The fields above stay put — only this block grows in. The
              <form> wrapper is scoped to just these fields so a save in
              the provider's setup form (rendered above this block) doesn't
              bubble up and submit the agent. */}
          {step === "configure" && (
            <form onSubmit={submitForm} className="contents">
            <FormField label="Name" error={errors.name?.message}>
              <Input placeholder="my-agent" autoFocus {...register("name")} />
            </FormField>
            <FormField label="Description">
              <Input placeholder="Optional" {...register("description")} />
            </FormField>

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
                      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
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
                  if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
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
                    <FolderUp size={14} /> Choose folder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importFileInputRef.current?.click()}
                  >
                    <FileIcon size={14} /> Choose files
                  </Button>
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
                <div className="text-[11px] text-muted-foreground italic">
                  Tip: drag-and-drop supports a mix of folders and files in one go.
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
                      <span className="font-mono truncate" title={g.name}>{g.name}</span>
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


            <ConnectionsPicker
              loading={loadSecrets}
              secrets={secrets}
              apps={apps}
              oauthApps={oauthAppEntries}
              selSecrets={selSecretsSet}
              selApps={selAppsSet}
              onToggleSecret={toggleSecret}
              onToggleApp={toggleApp}
              onGoToProviders={onGoToProviders}
            />

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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting || !isValid}>
                Create Agent
              </Button>
            </DialogFooter>
            </form>
          )}

          {step !== "configure" && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </DialogFooter>
          )}
      </DialogContent>
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
