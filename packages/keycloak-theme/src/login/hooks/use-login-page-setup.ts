import { useInitialize } from "keycloakify/login/Template.useInitialize";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useEffect } from "react";

import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";
import { useApplyThemeScript } from "./use-apply-theme-script.js";
import { useRotatingNameMeaning } from "./use-rotating-name-meaning.js";

export const BRAND_FALLBACK = "Platform";

// UNIT_BOUNDARY_DESCRIPTION: what every page of the theme does before it draws, whatever its layout: the light/dark script, Keycloak's own scripts (the session polling that notices a sign-in in another tab, and the realm's scripts) through keycloakify's useInitialize, the tab title, cleared html/body classes, and the brand name's rotating meaning. A page renders nothing until isReadyToRender.
export function useLoginPageSetup({
  kcContext,
  i18n,
  doUseDefaultCss,
  documentTitle,
}: {
  kcContext: KcContext;
  i18n: I18n;
  doUseDefaultCss: boolean;
  documentTitle?: string;
}) {
  const { realm } = kcContext;
  const { msgStr } = i18n;

  useApplyThemeScript();
  const nameMeaning = useRotatingNameMeaning(
    kcContext.properties.PLATFORM_BRAND_NAME_MEANINGS,
  );

  useEffect(() => {
    document.title =
      documentTitle ??
      (realm.displayNameHtml ||
        msgStr("loginTitle", realm.displayName || BRAND_FALLBACK));
  }, [documentTitle, msgStr, realm.displayNameHtml, realm.displayName]);

  useSetClassName({ qualifiedName: "html", className: "" });
  useSetClassName({ qualifiedName: "body", className: "" });

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  return { isReadyToRender, nameMeaning };
}

// UNIT_BOUNDARY_DESCRIPTION: whether a page shows Keycloak's message, as keycloakify's own Template decides: a warning raised by an app-initiated action is left out.
export function showsMessage(
  kcContext: Pick<KcContext, "message" | "isAppInitiatedAction">,
  displayMessage: boolean,
): boolean {
  return (
    displayMessage &&
    kcContext.message !== undefined &&
    (kcContext.message.type !== "warning" || !kcContext.isAppInitiatedAction)
  );
}
