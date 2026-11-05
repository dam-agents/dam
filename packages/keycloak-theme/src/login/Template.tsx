import type { TemplateProps } from "keycloakify/login/TemplateProps";

import { MessageAlert } from "./components/message-alert.js";
import {
  BRAND_FALLBACK,
  showsMessage,
  useLoginPageSetup,
} from "./hooks/use-login-page-setup.js";
import type { I18n } from "./i18n.js";
import type { KcContext } from "./KcContext.js";

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

  const { isReadyToRender, nameMeaning } = useLoginPageSetup({
    kcContext,
    i18n: props.i18n,
    doUseDefaultCss,
    documentTitle,
  });
  if (!isReadyToRender) return null;

  const showMessage = showsMessage(kcContext, displayMessage);

  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col justify-center px-6 py-12 md:px-[12.5%]">
        <div className="w-full max-w-[601px]">
          {nameMeaning && (
            <p
              key={nameMeaning}
              className="text-base font-semibold tracking-tight motion-safe:animate-fade-in md:text-xl"
            >
              {nameMeaning}
            </p>
          )}
          <h1 className="mt-3 text-5xl leading-[1.78] font-light tracking-[-0.03em] md:text-[64px] md:leading-[114px]">
            {headerNode}
          </h1>

          {showMessage && kcContext.message && (
            <MessageAlert
              message={kcContext.message}
              className="mt-6 max-w-[var(--width-login-col)]"
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
