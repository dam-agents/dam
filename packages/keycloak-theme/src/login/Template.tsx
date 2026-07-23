import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useEffect } from "react";

import { useApplyThemeScript } from "./hooks/use-apply-theme-script.js";
import type { I18n } from "./i18n.js";
import type { KcContext } from "./KcContext.js";

// Brand on the auth screens comes from the realm at runtime: `displayName`
// (Helm `brand.name`) names the sign-in heading, `displayNameHtml` (Helm
// `brand.title`, plain text) titles the browser tab like the web app. This
// is only the fallback for when they're absent — e.g. the local
// mocked-kcContext dev preview.
const BRAND_FALLBACK = "Platform";

export default function Template(props: TemplateProps<KcContext, I18n>) {
  const {
    displayMessage = true,
    headerNode,
    socialProvidersNode = null,
    documentTitle,
    kcContext,
    doUseDefaultCss,
    children,
  } = props;

  const { msgStr } = props.i18n;
  const { realm, message, isAppInitiatedAction } = kcContext;

  useApplyThemeScript();

  useEffect(() => {
    document.title =
      documentTitle ??
      (realm.displayNameHtml ||
        msgStr("loginTitle", realm.displayName || BRAND_FALLBACK));
  }, [documentTitle, msgStr, realm.displayNameHtml, realm.displayName]);

  useSetClassName({ qualifiedName: "html", className: "" });
  useSetClassName({ qualifiedName: "body", className: "" });

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  if (!isReadyToRender) return null;

  const showMessage =
    displayMessage &&
    message !== undefined &&
    (message.type !== "warning" || !isAppInitiatedAction);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col justify-center px-6 py-12 md:px-[12.5%]">
        <div className="w-full max-w-[601px]">
          <p className="text-base font-semibold tracking-tight md:text-xl">
            Deploy Agents Massively
          </p>
          <h1 className="mt-3 text-5xl leading-[1.78] font-light tracking-[-0.03em] md:text-[64px] md:leading-[114px]">
            {headerNode}
          </h1>

          {showMessage && (
            <div
              role="alert"
              className={
                message.type === "error"
                  ? "mt-6 max-w-[var(--width-login-col)] rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                  : "mt-6 max-w-[var(--width-login-col)] rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
              }
              dangerouslySetInnerHTML={{
                __html: kcSanitize(message.summary),
              }}
            />
          )}

          {children}
          {socialProvidersNode}
        </div>
      </div>
    </div>
  );
}

export { BRAND_FALLBACK };
