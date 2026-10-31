const DOCS_PAGES = {
  home: "",
  cliReference: "reference/cli/",
  liteLlmKey: "reference/litellm-key/",
  mcpServers: "core-concepts/connections/#mcp-servers",
} as const;

export type DocsPage = keyof typeof DOCS_PAGES;

export function docsPageUrl(root: string, page: DocsPage): string {
  const base = root.endsWith("/") ? root : `${root}/`;
  return new URL(DOCS_PAGES[page], base).href;
}
