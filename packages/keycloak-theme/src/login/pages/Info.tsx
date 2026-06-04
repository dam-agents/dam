import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

const ACTION_LINK_CLASS =
  "border-input bg-background hover:bg-muted focus-visible:ring-ring inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-8 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none";

export default function Info(
  props: PageProps<Extract<KcContext, { pageId: "info.ftl" }>, I18n>,
) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const {
    messageHeader,
    message,
    requiredActions,
    skipLink,
    pageRedirectUri,
    actionUri,
    client,
  } = kcContext;
  const { advancedMsgStr, msg } = i18n;

  const bodyHtml = (() => {
    let html = message.summary?.trim() ?? "";
    if (requiredActions) {
      html +=
        " <b>" +
        requiredActions
          .map((a) => advancedMsgStr(`requiredAction.${a}`))
          .join(", ") +
        "</b>";
    }
    return html;
  })();

  const action = (() => {
    if (skipLink) return null;
    if (pageRedirectUri)
      return { href: pageRedirectUri, label: msg("backToApplication") };
    if (actionUri) return { href: actionUri, label: msg("proceedWithAction") };
    if (client?.baseUrl)
      return { href: client.baseUrl, label: msg("backToApplication") };
    return null;
  })();

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      headerNode={
        <span
          dangerouslySetInnerHTML={{
            __html: kcSanitize(
              messageHeader ? advancedMsgStr(messageHeader) : message.summary,
            ),
          }}
        />
      }
    >
      <div className="space-y-6">
        <p
          className="text-foreground text-base leading-relaxed"
          dangerouslySetInnerHTML={{ __html: kcSanitize(bodyHtml) }}
        />

        {action && (
          <a href={action.href} className={ACTION_LINK_CLASS}>
            {action.label}
          </a>
        )}
      </div>
    </Template>
  );
}
