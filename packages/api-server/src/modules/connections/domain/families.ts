import type { ConnectionFamily } from "./connection-template.js";

export const GITHUB_FAMILY: ConnectionFamily = {
  id: "github",
  title: "GitHub",
};
export const GITHUB_ENTERPRISE_FAMILY: ConnectionFamily = {
  id: "github-enterprise",
  title: "GitHub Enterprise",
};
export const MODAL_FAMILY: ConnectionFamily = { id: "modal", title: "Modal" };
export const KUBERNETES_FAMILY: ConnectionFamily = {
  id: "kubernetes",
  title: "Kubernetes / OpenShift",
};
export const MCP_SERVER_FAMILY: ConnectionFamily = {
  id: "mcp-server",
  title: "MCP servers",
};
export const CUSTOM_HEADER_FAMILY: ConnectionFamily = {
  id: "custom-header",
  title: "Custom Headers",
};
