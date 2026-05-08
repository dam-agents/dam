import { zodResolver } from "@hookform/resolvers/zod";
import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import {
  ConnectionsPicker,
  type OAuthAppEntry,
} from "../../../components/connections-picker.js";
import { FormField } from "../../../components/form-field.js";
import type { EgressPreset, EnvVar, TemplateView } from "../../../types.js";
import { APP_OAUTH_SECRET_PREFIX } from "../../../types.js";
import {
  useAppConnections,
  useOAuthAppConnections,
} from "../../connections/api/queries.js";
import { useSecrets } from "../../secrets/api/queries.js";
import { addAgentSchema, type AddAgentValues } from "../forms/add-agent-schema.js";
import { envsToAddOnGrant } from "../utils/connection-env-helpers.js";

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
  }) => void;
  onCancel: () => void;
  onGoToProviders: () => void;
}) {
  const [step, setStep] = useState<Step>("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateView | null>(
    null,
  );
  const [customImage, setCustomImage] = useState("");

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

  // Auto-baseline the selSecrets default with the lone Anthropic provider
  // so the picker reflects the typical "of course you want this" default.
  // The submit always sends selSecrets — `setAgentAccess` is what creates
  // the connection-derived egress rules, and skipping it on undirty
  // leaves the agent with no rules for the granted secret.
  const baselinedRef = useRef(false);
  useEffect(() => {
    if (baselinedRef.current) return;
    if (secrets.length === 0) return;
    baselinedRef.current = true;
    const providers = secrets.filter((s) => s.type === "anthropic");
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
    // Derive env from each granted app's envMappings (dedupe by name across
    // apps — e.g. Gmail + Drive both declare GOOGLE_WORKSPACE_CLI_TOKEN).
    const grantedApps = apps.filter((a) => selAppsSet.has(a.id));
    const env = grantedApps.reduce<EnvVar[]>((acc, app) => {
      const toAdd = envsToAddOnGrant(acc, app);
      return toAdd.length > 0 ? [...acc, ...toAdd] : acc;
    }, []);
    onSubmit({
      name: values.name.trim(),
      templateId: selectedTemplate?.id,
      image: selectedTemplate ? undefined : customImage.trim(),
      description: values.description.trim() || undefined,
      env: env.length > 0 ? env : undefined,
      // Always send the picker's state — even when the user hasn't toggled,
      // the baselined default (single Anthropic provider) is real intent
      // and `setAgentAccess` is what triggers the connection-rules sync
      // server-side. Skipping it on undirty leaves the agent with no
      // connection-derived egress rules.
      secretIds: values.selSecrets,
      appConnectionIds: values.selApps.length > 0 ? values.selApps : undefined,
      egressPreset: values.egressPreset,
    });
  });

  const anthropicSecrets = secrets.filter((s) => s.type === "anthropic");

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="w-[520px] max-w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto sm:max-w-[520px]">
        {step === "pick" ? (
          <>
            <DialogHeader>
              <DialogTitle>Add Agent</DialogTitle>
            </DialogHeader>

            {templates.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.05em]">
                  From Template
                </span>
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => pickTemplate(tmpl)}
                    className="flex flex-col gap-1 rounded-lg border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary hover:bg-primary/10 min-w-0"
                  >
                    <div className="text-[14px] font-semibold text-foreground truncate w-full">{tmpl.name}</div>
                    {tmpl.description && <div className="text-[12px] text-muted-foreground truncate w-full">{tmpl.description}</div>}
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
                  onClick={pickCustom}
                  disabled={!customImage.trim()}
                  className="shrink-0"
                >
                  Use
                </Button>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submitForm} className="contents">
            <DialogHeader>
              <DialogTitle>Configure Agent</DialogTitle>
              <p className="text-[12px] text-muted-foreground mt-1">
                {selectedTemplate ? (
                  <>
                    Template:{" "}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="font-semibold text-foreground/80 border-b border-dotted border-muted-foreground cursor-help">
                          {selectedTemplate.name}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        <span className="font-mono">{selectedTemplate.image}</span>
                      </TooltipContent>
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

            <FormField label="Name" error={errors.name?.message}>
              <Input
                placeholder="my-agent"
                autoFocus
                {...register("name")}
              />
            </FormField>
            <FormField label="Description">
              <Input
                placeholder="Optional"
                {...register("description")}
              />
            </FormField>

            {!loadSecrets && anthropicSecrets.length === 0 && (
              <div className="rounded-lg border-2 border-warning bg-warning-light px-4 py-3 flex items-center gap-3">
                <Sparkles size={16} className="text-warning shrink-0" />
                <p className="text-[12px] text-foreground/80">
                  No provider configured, so this agent won't be able to reach an
                  AI model.{" "}
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
                  className="flex items-start gap-2 cursor-pointer rounded-lg border border-border bg-background px-4 py-2.5"
                >
                  <RadioGroupItem value="trusted" id="egress-trusted" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Trusted defaults (recommended)</span>
                    <span className="text-[12px] text-muted-foreground">npm, PyPI, GitHub, package mirrors, Anthropic</span>
                  </span>
                </Label>
                <Label
                  htmlFor="egress-none"
                  className="flex items-start gap-2 cursor-pointer rounded-lg border border-border bg-background px-4 py-2.5"
                >
                  <RadioGroupItem value="none" id="egress-none" className="mt-0.5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-[13px] font-semibold text-foreground">Strict default-deny</span>
                    <span className="text-[12px] text-muted-foreground">Every host hits the inbox until you approve</span>
                  </span>
                </Label>
                <Label
                  htmlFor="egress-all"
                  className="flex items-start gap-2 cursor-pointer rounded-lg border-2 border-warning/40 bg-background px-4 py-2.5"
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
              <Button type="button" variant="outline" onClick={() => setStep("pick")}>
                Back
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !isValid}
              >
                Create Agent
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
