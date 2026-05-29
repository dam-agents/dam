import type { ExtendKcContext } from "keycloakify/login";

import type { KcEnvName, ThemeName } from "../kc.gen.js";

export type KcContextExtension = {
  themeName: ThemeName;
  properties: Record<KcEnvName, string>;
};

export type KcContextExtensionPerPage = Record<string, Record<string, unknown>>;

export type KcContext = ExtendKcContext<
  KcContextExtension,
  KcContextExtensionPerPage
>;
