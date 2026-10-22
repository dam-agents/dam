import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

export default function LoginOauthGrant(
  props: PageProps<
    Extract<KcContext, { pageId: "login-oauth-grant.ftl" }>,
    I18n
  >,
) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { url, oauth, client } = kcContext;
  const { msg, msgStr, advancedMsg, advancedMsgStr } = i18n;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const clientName = client.name
    ? advancedMsgStr(client.name)
    : client.clientId;
  const hasInfo = Boolean(
    client.attributes.tosUri || client.attributes.policyUri,
  );

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      headerNode={
        <span className="flex items-center gap-3">
          {client.attributes.logoUri && (
            <img src={client.attributes.logoUri} alt="" className="h-8 w-8" />
          )}
          {msg("oauthGrantTitle", clientName)}
        </span>
      }
    >
      <div id="kc-oauth" className="space-y-6">
        <div className="space-y-3">
          <h3 className="text-foreground text-sm font-medium">
            {msg("oauthGrantRequest")}
          </h3>
          <ul className="space-y-2">
            {oauth.clientScopesRequested.map((clientScope) => (
              <li
                key={clientScope.consentScreenText}
                className="border-input bg-muted/40 text-foreground rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {advancedMsg(clientScope.consentScreenText)}
                  {clientScope.dynamicScopeParameter && (
                    <>
                      : <b>{clientScope.dynamicScopeParameter}</b>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {hasInfo && (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {msg("oauthGrantInformation", clientName)}
            {client.attributes.tosUri && (
              <>
                {" "}
                {msg("oauthGrantReview")}{" "}
                <a
                  href={client.attributes.tosUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {msg("oauthGrantTos")}
                </a>
              </>
            )}
            {client.attributes.policyUri && (
              <>
                {" "}
                {msg("oauthGrantReview")}{" "}
                <a
                  href={client.attributes.policyUri}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary underline underline-offset-2"
                >
                  {msg("oauthGrantPolicy")}
                </a>
              </>
            )}
          </p>
        )}

        <form
          className="flex gap-3"
          action={url.oauthAction}
          method="POST"
          onSubmit={() => {
            setIsSubmitting(true);
            return true;
          }}
        >
          <input type="hidden" name="code" value={oauth.code} />
          <Button
            type="submit"
            name="accept"
            id="kc-login"
            size="lg"
            className="flex-1"
            disabled={isSubmitting}
          >
            {msgStr("doYes")}
          </Button>
          <Button
            type="submit"
            name="cancel"
            id="kc-cancel"
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={isSubmitting}
          >
            {msgStr("doNo")}
          </Button>
        </form>
      </div>
    </Template>
  );
}
