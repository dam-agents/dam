import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import { SocialProviderButton } from "../components/social-provider-button.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";
import { BRAND_FALLBACK } from "../Template.js";

export default function Login(
  props: PageProps<Extract<KcContext, { pageId: "login.ftl" }>, I18n>,
) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { social, realm, url, usernameHidden, login, auth, messagesPerField } =
    kcContext;
  const { msg, msgStr } = i18n;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const usernameError = messagesPerField.existsError("username", "password");
  const usernameLabel = !realm.loginWithEmailAllowed
    ? msg("username")
    : !realm.registrationEmailAsUsername
      ? msg("usernameOrEmail")
      : msg("email");

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!usernameError}
      headerNode={`Sign in to ${realm.displayName || BRAND_FALLBACK}`}
    >
      {realm.password && (
        <form
          id="kc-form-login"
          className="space-y-4"
          onSubmit={() => {
            setIsSubmitting(true);
            return true;
          }}
          action={url.loginAction}
          method="post"
        >
          {!usernameHidden && (
            <div className="space-y-2">
              <Label htmlFor="username">{usernameLabel}</Label>
              <Input
                id="username"
                name="username"
                type="text"
                autoFocus
                autoComplete="username"
                tabIndex={2}
                defaultValue={login.username ?? ""}
                aria-invalid={usernameError}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="password">{msg("password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              tabIndex={3}
              aria-invalid={usernameError}
            />
          </div>

          {usernameError && (
            <span
              role="alert"
              aria-live="polite"
              className="block text-sm text-red-600"
              dangerouslySetInnerHTML={{
                __html: kcSanitize(
                  messagesPerField.getFirstError("username", "password"),
                ),
              }}
            />
          )}

          <input
            type="hidden"
            name="credentialId"
            value={auth.selectedCredential}
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
            tabIndex={7}
          >
            {msgStr("doLogIn")}
          </Button>
        </form>
      )}

      {realm.password &&
        social?.providers !== undefined &&
        social.providers.length > 0 && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="border-input w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase">
                  Or
                </span>
              </div>
            </div>

            <div className="space-y-2">
              {social.providers.map((p) => (
                <SocialProviderButton
                  key={p.alias}
                  provider={p}
                  resourcesPath={url.resourcesPath}
                />
              ))}
            </div>
          </>
        )}

      <p className="text-muted-foreground pt-2 text-xs">
        Secure sign-in powered by Keycloak
      </p>
    </Template>
  );
}
