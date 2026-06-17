import { kcSanitize } from "keycloakify/lib/kcSanitize";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useEffect } from "react";

import { AuroraBackdrop } from "./components/aurora-backdrop.js";
import { useApplyThemeScript } from "./hooks/use-apply-theme-script.js";
import type { I18n } from "./i18n.js";
import type { KcContext } from "./KcContext.js";

// Brand shown on the auth screens comes from the realm `displayName` at
// runtime (Helm `brand.name`). This is only the fallback for when it's
// absent — e.g. the local mocked-kcContext dev preview.
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
      msgStr("loginTitle", realm.displayName || BRAND_FALLBACK);
  }, [documentTitle, msgStr, realm.displayName]);

  useSetClassName({ qualifiedName: "html", className: "" });
  useSetClassName({ qualifiedName: "body", className: "" });

  const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
  if (!isReadyToRender) return null;

  const showMessage =
    displayMessage &&
    message !== undefined &&
    (message.type !== "warning" || !isAppInitiatedAction);

  return (
    <div className="relative min-h-screen bg-background">
      <AuroraBackdrop />

      <div className="relative z-10 flex min-h-screen items-center justify-center px-6 py-12 md:px-12 md:py-16">
        <div className="flex w-full max-w-[1400px] flex-col gap-12 md:flex-row md:items-center md:gap-16">
          {/* Form column */}
          <div className="flex md:w-1/2">
            <div className="w-full max-w-sm space-y-6">
              <h1 className="text-2xl font-semibold leading-none tracking-tight">
                {headerNode}
              </h1>

              {showMessage && (
                <div
                  role="alert"
                  className={
                    message.type === "error"
                      ? "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                      : "rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800"
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

          {/* Marketing column — hidden on mobile */}
          <div className="hidden md:flex md:w-1/2">
            <div className="max-w-xl space-y-6">
              <h2 className="text-[5rem] leading-[0.95] font-light tracking-tight lg:text-[8rem]">
                <span className="block">Deploy</span>
                <span className="block">Agents</span>
                <span className="block">Massively</span>
              </h2>
              <p className="text-muted-foreground text-xl leading-relaxed text-pretty">
                Run agent harnesses like Claude Code headless in the cloud, on a
                schedule, connected to your tools — without exposing your
                tokens.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export { BRAND_FALLBACK };
