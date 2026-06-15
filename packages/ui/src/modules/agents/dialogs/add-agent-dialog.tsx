import {
  Close as X,
  Document as FileIcon,
  Folder as FolderIcon,
  FolderAdd as FolderUp,
  Launch,
  Upload,
  Warning,
} from "@carbon/icons-react";
import { zodResolver } from "@hookform/resolvers/zod";
import type { AppConnectionView } from "api-server-api";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import { FormField } from "../../../components/form-field.js";
import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import { isProviderPresetType } from "../../../types.js";
import { useAppConnections } from "../../connections/api/queries.js";
import type { BundleEntry } from "../../files/api/import-bundle.js";
import { useImportPicker } from "../../files/hooks/use-import-picker.js";
import { useRepos } from "../../repos/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import {
  addAgentSchema,
  type AddAgentValues,
} from "../forms/add-agent-schema.js";
import { RegistryCredentialFields } from "./registry-credential-fields.js";

type Step = "pick" | "configure";

// `initSource` selects where the working directory is seeded from:
//   ""       → None (empty working dir, the default)
//   "local"  → upload local files (drag & drop)
//   <url>    → clone that catalog repo
const INIT_NONE = "";
const INIT_LOCAL = "local";

const tileClass = (active: boolean) =>
  `flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 cursor-pointer transition-colors ${
    active ? "border-primary bg-primary/10" : "bg-background hover:border-input"
  }`;

// Retained but no longer reachable: the sandbox wizard (modules/sandboxes)
// replaced this create flow, but does not yet support seeding a new sandbox's
// working directory (catalog-repo clone + local file upload). Kept so that
// seeding can be ported into the wizard rather than rebuilt from scratch.
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
    registryCredential?: { server: string; username: string; password: string };
    gitRepo?: { url: string; ref?: string };
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
  // Tracks top-level items for instant display; folders walk/filter in the background, resolved at submit.
  const importPicker = useImportPicker();
  const [dropActive, setDropActive] = useState(false);
  const [initSource, setInitSource] = useState<string>(INIT_NONE);

  // Switching the seed away from local drops any staged upload so it can't linger and get sent on submit.
  const selectInit = (value: string) => {
    setInitSource(value);
    if (value !== INIT_LOCAL) importPicker.clear();
  };
  const importFolderInputRef = useRef<HTMLInputElement | null>(null);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  const { data: secrets = [], isLoading: loadSecrets } = useSecrets();
  const { data: apps = [] } = useAppConnections();
  const { data: repos = [] } = useRepos();
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
      registryCredential: { server: "", username: "", password: "" },
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

  const clearRegistryCredential = () =>
    setValue(
      "registryCredential",
      { server: "", username: "", password: "" },
      { shouldValidate: true },
    );

  const selSecrets = watch("selSecrets");
  const selApps = watch("selApps");
  const selSecretsSet = useMemo(() => new Set(selSecrets), [selSecrets]);
  const selAppsSet = useMemo(() => new Set(selApps), [selApps]);

  // Join the api-server-driven OAuth app connections with their K8s
  // credential Secrets so the picker can render them in the "Apps"
  // subsection while the grant flows through the secret-access mechanism.
  const oauthAppEntries: OAuthAppEntry[] = [];

  // Repos compatible with the chosen harness. The custom-image path has no
  // known template id, so it offers no repos.
  const compatibleRepos = useMemo(
    () =>
      selectedTemplate
        ? repos.filter((r) =>
            r.compatibleTemplates.includes(selectedTemplate.id),
          )
        : [],
    [repos, selectedTemplate],
  );

  const pickTemplate = (tmpl: TemplateView) => {
    setSelectedTemplate(tmpl);
    setValue("name", tmpl.name);
    setValue("description", tmpl.description ?? "");
    // Repo compatibility is per-harness; reset the working-dir seed.
    selectInit(INIT_NONE);
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
    selectInit(INIT_NONE);
    trigger();
    setStep("configure");
  };

  const submitForm = handleSubmit(async (values) => {
    // initSource holds the chosen catalog repo's url (or "" / "local").
    const selectedRepo = compatibleRepos.find((r) => r.url === initSource);
    // Await background walks here, not on drop — isSubmitting keeps the button busy meanwhile.
    const importEntries =
      initSource === INIT_LOCAL ? await importPicker.resolveEntries() : [];
    const reg = values.registryCredential;
    const registryCredential =
      !selectedTemplate && reg.server ? reg : undefined;
    // ADR-040: env contributions from granted secrets/apps are merged at
    // pod-render time by the controller. Don't pre-stamp them onto the
    // agent spec.
    onSubmit({
      name: values.name.trim(),
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      // Send the trimmed value verbatim — including "" when the user clears
      // it — so an explicitly-empty description stays empty. spec-assembly
      // only falls back to the template's description when this is genuinely
      // undefined (e.g. a non-UI API caller that omits the field entirely).
      description: values.description.trim(),
      // Always send the picker's state — even when the user hasn't toggled,
      // the baselined default (single provider preset) is real intent and
      // `setAgentAccess` is what triggers the connection-rules sync
      // server-side. Skipping it on undirty leaves the agent with no
      // connection-derived egress rules.
      secretIds: values.selSecrets,
      appConnectionIds: values.selApps.length > 0 ? values.selApps : undefined,
      egressPreset: values.egressPreset,
      registryCredential,
      gitRepo: selectedRepo
        ? { url: selectedRepo.url, ref: selectedRepo.ref }
        : undefined,
      importEntries: importEntries.length > 0 ? importEntries : undefined,
      importRawBundle:
        initSource === INIT_LOCAL
          ? (importPicker.rawBundle ?? undefined)
          : undefined,
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
                  <Tooltip
                    side="right"
                    content={
                      <span className="font-mono">
                        {selectedTemplate.image}
                      </span>
                    }
                  >
                    <span className="font-semibold text-foreground/80 border-b border-dotted border-muted-foreground cursor-help">
                      {selectedTemplate.name}
                    </span>
                  </Tooltip>
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

            {!selectedTemplate && (
              <RegistryCredentialFields
                register={register}
                errors={errors.registryCredential}
                onCollapse={clearRegistryCredential}
              />
            )}

            <fieldset className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                Initialize working directory
              </span>
              <p className="text-[12px] text-muted-foreground">
                Where the agent's working directory starts from. You can change
                its files later.
              </p>
              <div className="grid grid-cols-2 gap-1.5 auto-rows-fr">
                <label className={tileClass(initSource === INIT_NONE)}>
                  <input
                    type="radio"
                    className="sr-only"
                    checked={initSource === INIT_NONE}
                    onChange={() => selectInit(INIT_NONE)}
                  />
                  <span className="text-[13px] font-semibold text-foreground">
                    None
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    Empty working directory
                  </span>
                </label>
                {compatibleRepos.map((repo) => (
                  <label
                    key={repo.id}
                    className={tileClass(initSource === repo.url)}
                  >
                    <input
                      type="radio"
                      className="sr-only"
                      checked={initSource === repo.url}
                      onChange={() => selectInit(repo.url)}
                    />
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[13px] font-semibold text-foreground truncate">
                        {repo.name}
                      </span>
                      <a
                        href={repo.readmeUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 text-[11px] text-primary hover:underline shrink-0"
                      >
                        README <Launch size={11} />
                      </a>
                    </span>
                    {repo.description && (
                      <span className="text-[12px] text-muted-foreground line-clamp-2">
                        {repo.description}
                      </span>
                    )}
                  </label>
                ))}
                <label className={tileClass(initSource === INIT_LOCAL)}>
                  <input
                    type="radio"
                    className="sr-only"
                    checked={initSource === INIT_LOCAL}
                    onChange={() => selectInit(INIT_LOCAL)}
                  />
                  <span className="text-[13px] font-semibold text-foreground">
                    Local files
                  </span>
                  <span className="text-[12px] text-muted-foreground">
                    Upload from your machine
                  </span>
                </label>
              </div>

              {initSource === INIT_LOCAL && (
                <div className="mt-1 flex flex-col gap-2">
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
                      importPicker.addBundleEntries(
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
                      importPicker.addBundleEntries(
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
                        e.currentTarget.contains(e.relatedTarget as Node | null)
                      )
                        return;
                      setDropActive(false);
                    }}
                    onDrop={(e) => {
                      if (!e.dataTransfer) return;
                      e.preventDefault();
                      setDropActive(false);
                      const items = e.dataTransfer.items;
                      if (items && items.length > 0)
                        importPicker.addDrop(items);
                    }}
                    className={`rounded-lg border-2 border-dashed px-4 py-6 transition-colors flex flex-col items-center gap-3 text-center ${
                      dropActive
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-input bg-background/50"
                    }`}
                  >
                    {importPicker.rawBundle ? (
                      <>
                        <FileIcon size={24} className="text-muted-foreground" />
                        <div className="text-[13px] text-foreground">
                          <code className="font-mono">
                            {importPicker.rawBundle.name}
                          </code>
                        </div>
                      </>
                    ) : importPicker.picks.length > 0 ? (
                      <>
                        <Upload size={24} className="text-muted-foreground" />
                        <div className="text-[13px] text-foreground">
                          {importPicker.summary}
                        </div>
                      </>
                    ) : (
                      <>
                        <Upload size={28} className="text-muted-foreground" />
                        <div className="text-[13px] text-foreground">
                          Drop a folder or files here
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          <code className="font-mono">.tar.gz</code> bundles
                          pass through verbatim
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
                      {importPicker.hasContent && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          onClick={importPicker.clear}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground italic">
                      Tip: drag-and-drop supports a mix of folders and files in
                      one go.
                    </div>
                  </div>
                  {importPicker.picks.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {importPicker.picks.map((pick) => (
                        <span
                          key={pick.key}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[12px] text-foreground max-w-full"
                        >
                          {pick.isFolder ? (
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
                          <span
                            className="font-mono truncate"
                            title={pick.name}
                          >
                            {pick.name}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            onClick={() => importPicker.removePick(pick.key)}
                            className="shrink-0"
                            aria-label={`Remove ${pick.name}`}
                          >
                            <X size={12} />
                          </Button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </fieldset>

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
