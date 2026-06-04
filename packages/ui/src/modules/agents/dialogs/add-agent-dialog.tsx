import {
  Close as X,
  Document as FileIcon,
  Folder as FolderIcon,
  FolderAdd as FolderUp,
  Upload,
  Warning,
} from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AppConnectionView } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import { FormField } from "../../../components/form-field.js";
import { HoverTooltip } from "../../../components/hover-tooltip.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import { isProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import {
  type BundleEntry,
  filterImportEntries,
  isTarballName,
  walkDataTransfer,
} from "../../files/api/import-bundle.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  addAgentSchema,
  type AddAgentValues,
} from "../forms/add-agent-schema.js";

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

  return (
    <Modal widthClass="w-[520px]">
      {step === "pick" ? (
        <>
          <DialogHeader>
            <h2 className="text-[20px] font-bold text-foreground">Add Agent</h2>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-5">
            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                  From Template
                </span>
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => pickTemplate(tmpl)}
                    className="flex flex-col gap-1 rounded-lg border bg-background px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/10 min-w-0"
                  >
                    <div className="text-[14px] font-semibold text-foreground truncate w-full">
                      {tmpl.name}
                    </div>
                    {tmpl.description && (
                      <div className="text-[12px] text-muted-foreground truncate w-full">
                        {tmpl.description}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                Custom Image
              </span>
              <div className="flex gap-2">
                <Input
                  value={customImage}
                  onChange={(e) => setCustomImage(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && pickCustom()}
                  placeholder="ghcr.io/org/agent:latest"
                />
                <Button
                  type="button"
                  className="shrink-0"
                  onClick={pickCustom}
                  disabled={!customImage.trim()}
                >
                  Use
                </Button>
              </div>
            </div>
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={submitForm} className="contents">
          <DialogHeader>
            <h2 className="text-[20px] font-bold text-foreground">
              Configure Agent
            </h2>
            <p className="text-[12px] text-muted-foreground mt-1">
              {selectedTemplate ? (
                <>
                  Template:{" "}
                  <HoverTooltip
                    placement="right"
                    trigger={
                      <span className="font-semibold text-foreground/80 border-b border-dotted border-muted-foreground cursor-help">
                        {selectedTemplate.name}
                      </span>
                    }
                  >
                    <span className="font-mono">{selectedTemplate.image}</span>
                  </HoverTooltip>
                </>
              ) : (
                <>
                  Image:{" "}
                  <span className="font-mono text-foreground/80 break-all">
                    {customImage}
                  </span>
                </>
              )}
            </p>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-5">
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
                className={`rounded-lg border-2 border-dashed px-4 py-6 transition-colors flex flex-col items-center gap-3 text-center ${
                  dropActive
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-input bg-background/50"
                }`}
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
                      <span className="font-semibold">
                        {importEntries.length + importDropped}
                      </span>{" "}
                      file
                      {importEntries.length + importDropped === 1
                        ? ""
                        : "s"}{" "}
                      selected ·{" "}
                      <span className="text-foreground/80">
                        {importEntries.length} to import
                      </span>
                      {importDropped > 0 && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="text-muted-foreground">
                            {importDropped} filtered (
                            <code className="font-mono">node_modules</code>,{" "}
                            <code className="font-mono">.venv</code>, etc.)
                          </span>
                        </>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <Upload size={28} className="text-muted-foreground" />
                    <div className="text-[13px] text-foreground">
                      Drop a folder or files here
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      <code className="font-mono">.tar.gz</code> bundles pass
                      through verbatim
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
                    <FolderUp /> Choose folder
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => importFileInputRef.current?.click()}
                  >
                    <FileIcon /> Choose files
                  </Button>
                  {(importRawBundle || importEntries.length > 0) && (
                    <button
                      type="button"
                      onClick={() => {
                        setImportEntries([]);
                        setImportRawBundle(null);
                        setImportDropped(0);
                      }}
                      className="text-[12px] text-muted-foreground hover:text-foreground underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="text-[11px] text-muted-foreground italic">
                  Tip: drag-and-drop supports a mix of folders and files in one
                  go.
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
                        <FolderIcon
                          size={12}
                          className="text-muted-foreground shrink-0"
                        />
                      ) : (
                        <FileIcon
                          size={12}
                          className="text-muted-foreground shrink-0"
                        />
                      )}
                      <span className="font-mono truncate" title={g.name}>
                        {g.name}
                      </span>
                      {g.isFolder && (
                        <span className="text-muted-foreground shrink-0">
                          ({g.count})
                        </span>
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

            {!loadSecrets && providerSecrets.length === 0 && (
              <div className="rounded-lg border-2 border-warning bg-warning-light px-4 py-3 flex items-center gap-3">
                <Warning size={16} className="text-warning shrink-0" />
                <p className="text-[12px] text-foreground/80">
                  No provider configured, so this agent won't be able to reach
                  an AI model.{" "}
                  <button
                    type="button"
                    className="text-primary font-semibold hover:underline"
                    onClick={onGoToProviders}
                  >
                    Set one up
                  </button>
                </p>
              </div>
            )}

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

            <fieldset className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                Network access
              </span>
              <p className="text-[12px] text-muted-foreground">
                Initial set of hosts the agent can reach. Anything not covered
                surfaces in the inbox; you can change this later from the
                agent's Network access tab.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5">
                  <input
                    type="radio"
                    value="trusted"
                    className="mt-0.5 w-4 h-4 accent-primary"
                    {...register("egressPreset")}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      Trusted defaults (recommended)
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      npm, PyPI, GitHub, package mirrors, Anthropic
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer rounded-lg border bg-background px-4 py-2.5">
                  <input
                    type="radio"
                    value="none"
                    className="mt-0.5 w-4 h-4 accent-primary"
                    {...register("egressPreset")}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      Strict default-deny
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      Every host hits the inbox until you approve
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-2 cursor-pointer rounded-lg border border-warning/40 bg-background px-4 py-2.5">
                  <input
                    type="radio"
                    value="all"
                    className="mt-0.5 w-4 h-4 accent-primary"
                    {...register("egressPreset")}
                  />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">
                      Allow everything
                    </span>
                    <span className="text-[12px] text-muted-foreground">
                      Development escape hatch — no inbox prompts
                    </span>
                  </span>
                </label>
              </div>
            </fieldset>
          </DialogBody>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep("pick")}
            >
              Back
            </Button>
            <Button
              type="submit"
              className={!isValid ? "opacity-40" : ""}
              disabled={isSubmitting}
            >
              Create Agent
            </Button>
          </DialogFooter>
        </form>
      )}
    </Modal>
  );
}
