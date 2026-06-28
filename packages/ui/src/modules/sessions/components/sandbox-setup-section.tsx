import {
  Add,
  CheckboxCheckedFilled,
  ChevronDown,
  TrashCan,
} from "@carbon/icons-react";
import { AlertTriangle, Globe, KeyRound, Lock } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { useStore } from "../../../store.js";
import { OAuthAppIcon } from "../../connections/components/oauth-app-icon.js";
import { CardIcon } from "../../settings/components/shared/card-icon.js";

const MOCK_CONNECTIONS = [
  { id: "conn-1", templateId: "github", name: "jamies-github-test" },
  { id: "conn-2", templateId: "github", name: "jamies-ibm-github-connection" },
];

interface EgressRule {
  id: string;
  host: string;
  method: string;
  pathPattern: string;
  verdict: "allow" | "deny";
  source: string;
}

const MOCK_EGRESS_RULES: EgressRule[] = [
  {
    id: "r1",
    host: "api.anthropic.com",
    method: "*",
    pathPattern: "*",
    verdict: "allow",
    source: "preset:trusted",
  },
  {
    id: "r2",
    host: "registry.npmjs.org",
    method: "GET",
    pathPattern: "*",
    verdict: "allow",
    source: "preset:trusted",
  },
  {
    id: "r3",
    host: "pypi.org",
    method: "GET",
    pathPattern: "*",
    verdict: "allow",
    source: "preset:trusted",
  },
  {
    id: "r4",
    host: "github.com",
    method: "*",
    pathPattern: "*",
    verdict: "allow",
    source: "preset:trusted",
  },
  {
    id: "r5",
    host: "api.openai.com",
    method: "*",
    pathPattern: "/v1/*",
    verdict: "allow",
    source: "manual",
  },
];

interface InheritedEnv {
  name: string;
  value: string;
  source: "system" | { secretName: string } | { appLabel: string };
}

const MOCK_INHERITED_ENV: InheritedEnv[] = [
  { name: "HOME", value: "/home/agent", source: "system" },
  { name: "PORT", value: "8080", source: "system" },
  {
    name: "ANTHROPIC_API_KEY",
    value: "sk-ant-••••••••",
    source: { secretName: "anthropic-key" },
  },
  {
    name: "GITHUB_TOKEN",
    value: "ghp_••••••••",
    source: { appLabel: "GitHub" },
  },
];

interface EnvVar {
  name: string;
  value: string;
}

const MOCK_CUSTOM_ENV: EnvVar[] = [
  { name: "NODE_ENV", value: "development" },
  { name: "LOG_LEVEL", value: "debug" },
  { name: "API_TIMEOUT", value: "30000" },
];

type EgressPreset = "trusted" | "none" | "all";

export function SandboxSetupSection() {
  const [name, setName] = useState("DAM Design helper");
  const [image, setImage] = useState("claude-code");
  const [provider, setProvider] = useState("anthropic");
  const [networkOpen, setNetworkOpen] = useState(true);
  const [envOpen, setEnvOpen] = useState(true);
  const [preset, setPreset] = useState<EgressPreset>("trusted");
  const [rules, setRules] = useState(MOCK_EGRESS_RULES);
  const [customEnv, setCustomEnv] = useState(MOCK_CUSTOM_ENV);
  const [newRuleHost, setNewRuleHost] = useState("");
  const [newRuleMethod, setNewRuleMethod] = useState("*");
  const [newRulePath, setNewRulePath] = useState("*");
  const setView = useStore((s) => s.setView);

  const deleteRule = (id: string) => {
    setRules((prev) => prev.filter((r) => r.id !== id));
  };

  const addRule = () => {
    if (!newRuleHost.trim()) return;
    const rule: EgressRule = {
      id: `r-${Date.now()}`,
      host: newRuleHost.trim(),
      method: newRuleMethod,
      pathPattern: newRulePath || "*",
      verdict: "allow",
      source: "manual",
    };
    setRules((prev) => [...prev, rule]);
    setNewRuleHost("");
    setNewRuleMethod("*");
    setNewRulePath("*");
  };

  const addEnvVar = () => {
    setCustomEnv((prev) => [...prev, { name: "", value: "" }]);
  };

  const updateEnvVar = (
    index: number,
    field: "name" | "value",
    val: string,
  ) => {
    setCustomEnv((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: val } : v)),
    );
  };

  const removeEnvVar = (index: number) => {
    setCustomEnv((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="flex flex-col gap-8">
      {/* NAME */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-1">
          Name
        </label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-10 rounded-lg border-border"
        />
      </div>

      {/* IMAGE */}
      <div className="flex flex-col gap-2">
        <label className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-1">
          Image
        </label>
        <Select value={image} onValueChange={setImage}>
          <SelectTrigger className="h-10 rounded-lg border-border">
            <div className="flex items-center gap-2">
              <CardIcon provider="anthropic" size="sm" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude-code">Claude Code</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
            <SelectItem value="ibm-bob">IBM Bob</SelectItem>
            <SelectItem value="pi-agent">Pi Agent</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground pl-1">
          Image is set at creation time and cannot be changed.
        </p>
      </div>

      {/* PROVIDER */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-1">
            Provider
          </label>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage providers
          </button>
        </div>
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger className="h-10 rounded-lg border-border">
            <div className="flex items-center gap-2">
              <CardIcon provider="anthropic" size="sm" />
              <SelectValue />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="anthropic">Anthropic</SelectItem>
            <SelectItem value="ibm-litellm">IBM watsonx</SelectItem>
            <SelectItem value="openai">OpenAI</SelectItem>
            <SelectItem value="bob">BeeAI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* MY CONNECTIONS */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground pl-1">
            My Connections
          </label>
          <button
            type="button"
            onClick={() => setView("settings")}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            Manage connections
          </button>
        </div>
        <div className="flex flex-col gap-2.5 pl-1">
          {MOCK_CONNECTIONS.map((c) => (
            <div key={c.id} className="flex items-center gap-2.5">
              <CheckboxCheckedFilled
                size={16}
                className="text-foreground shrink-0"
              />
              <OAuthAppIcon appId={c.templateId} alt={c.name} size={16} />
              <span className="text-[13px] text-foreground/80">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* NETWORK ACCESS */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setNetworkOpen(!networkOpen)}
          className="flex items-center justify-between pl-1 group"
        >
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground">
              Network Access
            </span>
          </div>
          <ChevronDown
            size={16}
            className={cn(
              "text-muted-foreground transition-transform",
              !networkOpen && "-rotate-90",
            )}
          />
        </button>

        {networkOpen && (
          <div className="flex flex-col gap-4 pl-1">
            {/* Preset selector */}
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-muted-foreground shrink-0">
                Preset:
              </span>
              <div className="flex gap-1.5">
                {(["trusted", "none", "all"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPreset(p)}
                    className={cn(
                      "px-3 py-1.5 rounded-md text-[12px] font-medium transition-colors border",
                      preset === p
                        ? "bg-muted border-border text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    {p === "trusted"
                      ? "Trusted defaults"
                      : p === "none"
                        ? "Deny all"
                        : "Allow all"}
                  </button>
                ))}
              </div>
            </div>

            {preset === "all" && (
              <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/5 px-3 py-2 text-[11px] text-warning">
                <AlertTriangle size={12} />
                Allow all is a development escape hatch — not recommended for
                production.
              </div>
            )}

            {/* Rules table */}
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="grid grid-cols-[1fr_80px_1fr_60px_32px] gap-2 px-3 py-2 bg-muted/30 border-b border-border text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                <span>Host</span>
                <span>Method</span>
                <span>Path</span>
                <span>Verdict</span>
                <span />
              </div>
              {rules.map((rule) => (
                <div
                  key={rule.id}
                  className="grid grid-cols-[1fr_80px_1fr_60px_32px] gap-2 px-3 py-2 border-b border-border/50 text-[12px] items-center group hover:bg-muted/20 transition-colors"
                >
                  <span className="font-mono text-foreground truncate">
                    {rule.host}
                  </span>
                  <span className="font-mono text-muted-foreground">
                    {rule.method}
                  </span>
                  <span className="font-mono text-muted-foreground truncate">
                    {rule.pathPattern}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-medium uppercase",
                      rule.verdict === "allow"
                        ? "text-emerald-500"
                        : "text-destructive",
                    )}
                  >
                    {rule.verdict}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteRule(rule.id)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all p-0.5 rounded"
                  >
                    <TrashCan size={12} />
                  </button>
                </div>
              ))}
              {/* Add rule inline */}
              <div className="grid grid-cols-[1fr_80px_1fr_60px_32px] gap-2 px-3 py-2 items-center bg-muted/10">
                <Input
                  placeholder="api.example.com"
                  value={newRuleHost}
                  onChange={(e) => setNewRuleHost(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRule()}
                  className="h-7 text-[12px] font-mono border-border"
                />
                <select
                  value={newRuleMethod}
                  onChange={(e) => setNewRuleMethod(e.target.value)}
                  className="h-7 text-[12px] rounded-md border border-border bg-background px-1.5"
                >
                  <option value="*">ANY</option>
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="PUT">PUT</option>
                  <option value="PATCH">PATCH</option>
                  <option value="DELETE">DELETE</option>
                </select>
                <Input
                  placeholder="*"
                  value={newRulePath}
                  onChange={(e) => setNewRulePath(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addRule()}
                  className="h-7 text-[12px] font-mono border-border"
                />
                <span className="text-[10px] font-medium uppercase text-emerald-500">
                  allow
                </span>
                <button
                  type="button"
                  onClick={addRule}
                  disabled={!newRuleHost.trim()}
                  className="text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors p-0.5 rounded"
                >
                  <Add size={14} />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ENVIRONMENT */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setEnvOpen(!envOpen)}
          className="flex items-center justify-between pl-1 group"
        >
          <div className="flex items-center gap-2">
            <KeyRound size={14} className="text-muted-foreground" />
            <span className="text-[11px] font-medium uppercase tracking-[1.65px] text-foreground">
              Environment
            </span>
          </div>
          <ChevronDown
            size={16}
            className={cn(
              "text-muted-foreground transition-transform",
              !envOpen && "-rotate-90",
            )}
          />
        </button>

        {envOpen && (
          <div className="flex flex-col gap-5 pl-1">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Variables added here are sent directly to the agent as plaintext.
              Use them only for non-sensitive config — never secrets, which
              belong in Connections. Restart the agent to pick up changes.
            </p>

            {/* Inherited */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Inherited
              </span>
              <div className="flex flex-col gap-1">
                {MOCK_INHERITED_ENV.map((entry) => {
                  const isSystem = entry.source === "system";
                  const sourceLabel =
                    entry.source === "system"
                      ? null
                      : "secretName" in entry.source
                        ? entry.source.secretName
                        : entry.source.appLabel;
                  return (
                    <div
                      key={entry.name}
                      className="flex items-center gap-2 rounded-md border border-border/50 bg-muted/20 px-3 py-1.5 text-[12px]"
                    >
                      <span
                        className="shrink-0 text-muted-foreground"
                        title={
                          isSystem ? "Platform-managed" : `From: ${sourceLabel}`
                        }
                      >
                        {isSystem ? <Lock size={12} /> : <KeyRound size={12} />}
                      </span>
                      <span className="font-mono font-semibold text-foreground/90 truncate">
                        {entry.name}
                      </span>
                      <span className="text-muted-foreground">=</span>
                      <span className="font-mono text-muted-foreground truncate flex-1">
                        {entry.value}
                      </span>
                      {!isSystem && sourceLabel && (
                        <span className="text-[10px] text-muted-foreground/70 truncate max-w-[120px]">
                          {sourceLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Custom */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Custom
              </span>
              <div className="flex flex-col gap-1.5">
                {customEnv.map((v, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      placeholder="KEY"
                      value={v.name}
                      onChange={(e) => updateEnvVar(i, "name", e.target.value)}
                      className="h-8 text-[12px] font-mono flex-1 border-border"
                    />
                    <span className="text-muted-foreground text-[12px]">=</span>
                    <Input
                      placeholder="value"
                      value={v.value}
                      onChange={(e) => updateEnvVar(i, "value", e.target.value)}
                      className="h-8 text-[12px] font-mono flex-[2] border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeEnvVar(i)}
                      className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                    >
                      <TrashCan size={12} />
                    </button>
                  </div>
                ))}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="w-fit text-[12px] gap-1.5"
                onClick={addEnvVar}
              >
                <Add size={12} />
                Add variable
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Submit button */}
      <div className="flex justify-end pt-2 border-t border-border">
        <Button
          variant="outline"
          size="sm"
          className="rounded-md text-[13px] font-medium"
        >
          Save changes
        </Button>
      </div>
    </div>
  );
}
