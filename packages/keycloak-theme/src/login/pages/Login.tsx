import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Label } from "../../components/label";
import { LOGIN_DOCS_URL } from "../../constants";
import { SocialProviderButton } from "../components/social-provider-button";
import type { I18n } from "../i18n";
import type { KcContext } from "../KcContext";
import { BRAND_FALLBACK } from "../Template";

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

  const providers = social?.providers ?? [];
  // Strict "false" check fails open to the password form on any unexpected
  // value, and a deployment that disallows passwords without configuring an
  // identity provider still gets a working sign-in.
  const isSsoOnly =
    kcContext.properties.PLATFORM_ALLOW_PASSWORD === "false" &&
    providers.length > 0;
  const requestAccessUrl = kcContext.properties.PLATFORM_REQUEST_ACCESS_URL;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={!usernameError}
      headerNode={`Sign in to ${realm.displayName || BRAND_FALLBACK}`}
    >
      <p className="mt-6 text-base leading-relaxed text-pretty md:text-xl">
        Run AI-driven experiments with the harness and model you choose,
        connected to your tools. Governed access, auditable execution, built to
        repeat.{" "}
        <a
          href={LOGIN_DOCS_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent hover:underline"
        >
          Read the docs to learn more.
        </a>
      </p>

      {!isSsoOnly && realm.password && (
        <form
          id="kc-form-login"
          className="mt-12 max-w-[var(--width-login-col)] space-y-4"
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
                placeholder="you@example.com"
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
              placeholder="••••••••"
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

      {isSsoOnly ? (
        <div className="mt-14 max-w-[var(--width-login-col)] space-y-2">
          {providers.map((p) => (
            <SocialProviderButton key={p.alias} provider={p} />
          ))}
        </div>
      ) : (
        providers.length > 0 && (
          <div className="mt-4 max-w-[var(--width-login-col)]">
            {realm.password && (
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="border-input w-full border-t" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-background text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase">
                    Or
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {providers.map((p) => (
                <SocialProviderButton key={p.alias} provider={p} />
              ))}
            </div>
          </div>
        )
      )}

      {requestAccessUrl && (
        <p className="mt-20">
          <a
            href={requestAccessUrl}
            className="text-base text-accent hover:underline md:text-xl"
          >
            Request access
          </a>
        </p>
      )}
    </Template>
  );
}
