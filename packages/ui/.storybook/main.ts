import { readFileSync } from "node:fs";
import path from "node:path";

import type { StorybookConfig } from "@storybook/react-vite";
import type { Plugin, PluginOption } from "vite";
import { parse } from "yaml";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

/** Brand comes from the chart's values, the same source the api-server reads. */
function helmBrand(): unknown {
  const values = parse(
    readFileSync(path.join(repoRoot, "helm/values.yaml"), "utf8"),
  ) as { brand: unknown };
  return values.brand;
}

/** The handful of plain-HTTP endpoints the UI fetches outside tRPC. */
function fakeHttpEndpoints(): Plugin {
  const json: Record<string, () => unknown> = {
    "/api/brand": helmBrand,
    "/api/version": () => ({ appVersion: "storybook" }),
    "/api/slack/install/status": () => ({ canInstall: true }),
    // Installs supply their own terms (`helm --set-file terms.text=…`).
    "/api/terms": () => ({
      version: "storybook",
      text: "## Terms of use\n\n_Placeholder: each install supplies its own terms text via Helm._",
      hash: "storybook",
    }),
    "/api/auth/config": () => ({
      issuer: "http://localhost/storybook",
      clientId: "storybook",
      cliClientId: "storybook-cli",
    }),
  };
  return {
    name: "storybook-fake-http",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const handler = json[(req.url ?? "").split("?")[0]!];
        if (!handler) return next();
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(handler()));
      });
    },
  };
}

const isPwaPlugin = (p: PluginOption): boolean =>
  !!p &&
  typeof p === "object" &&
  "name" in p &&
  typeof p.name === "string" &&
  p.name.startsWith("vite-plugin-pwa");

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  viteFinal: (viteConfig) => {
    // A registered PWA service worker would outlive the story and cache the iframe.
    viteConfig.plugins = [
      ...(viteConfig.plugins ?? [])
        .flat()
        .filter((p) => !isPwaPlugin(p as PluginOption)),
      fakeHttpEndpoints(),
    ];
    viteConfig.resolve ??= {};
    viteConfig.resolve.alias = [
      ...(Array.isArray(viteConfig.resolve.alias)
        ? viteConfig.resolve.alias
        : Object.entries(viteConfig.resolve.alias ?? {}).map(
            ([find, replacement]) => ({ find, replacement }),
          )),
      {
        find: /^oidc-client-ts$/,
        replacement: path.resolve(import.meta.dirname, "../src/stories/backend/oidc.ts"),
      },
    ];
    if (viteConfig.server) viteConfig.server.proxy = undefined;
    return viteConfig;
  },
};

export default config;
