import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";

import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

export default function Error(
  props: PageProps<Extract<KcContext, { pageId: "error.ftl" }>, I18n>,
) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { message, client, skipLink } = kcContext;
  const { msg } = i18n;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={false}
      headerNode={msg("errorTitle")}
    >
      <div className="space-y-6">
        <p
          className="text-foreground text-base leading-relaxed"
          dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
        />

        {!skipLink && !!client?.baseUrl && (
          <a
            id="backToApplication"
            href={client.baseUrl}
            className="border-input bg-background hover:bg-muted focus-visible:ring-ring inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-8 text-sm font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            {msg("backToApplication")}
          </a>
        )}
      </div>
    </Template>
  );
}
