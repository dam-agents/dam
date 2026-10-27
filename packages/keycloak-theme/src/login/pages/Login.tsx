import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState, type ReactNode } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import { cn } from "../../lib/cn.js";
import { InteractiveCharacterWidget } from "../components/animated-characters.js";
import { HeroBgShapes } from "../components/hero-bg-shapes.js";
import {
  BandAccess,
  BandCapabilities,
  BandChannels,
  BandDevOps,
  BandIntegrations,
  BandSandbox,
  BandTestimonials,
} from "../components/info-bands.js";
import { SlackDmIllustration } from "../components/slack-dm-illustration.js";
import { SocialProviderButton } from "../components/social-provider-button.js";
import { useApplyThemeScript } from "../hooks/use-apply-theme-script.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

type LoginContext = Extract<KcContext, { pageId: "login.ftl" }>;

const LOGIN_DOCS_URL = "https://ibm.biz/dam-docs";

export default function Login(props: PageProps<LoginContext, I18n>) {
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
  const isSsoOnly =
    kcContext.properties.PLATFORM_ALLOW_PASSWORD === "false" &&
    providers.length > 0;
  const isShareSignIn =
    kcContext.client.clientId === kcContext.properties.PLATFORM_SHARE_CLIENT_ID;
  const providerButtons = providers.map((p) => (
    <SocialProviderButton key={p.alias} provider={p} />
  ));

  const formProps = {
    url,
    realm,
    login,
    auth,
    usernameHidden,
    usernameError,
    usernameLabel,
    messagesPerField,
    isSsoOnly,
    isSubmitting,
    setIsSubmitting,
    providerButtons,
    msgStr,
    msg,
  };

  if (isShareSignIn) {
    return (
      <Template
        kcContext={kcContext}
        i18n={i18n}
        doUseDefaultCss={doUseDefaultCss}
        classes={classes}
        displayMessage={!usernameError}
        headerNode="Sign in to view this artifact"
      >
        <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
          Sign in with your account to view the shared artifact.
        </p>
        <LoginForm {...formProps} formId="kc-form-login" autoFocusInput />
        <LoginLinks className="mt-8" />
      </Template>
    );
  }

  return (
    <ScrollPage
      kcContext={kcContext}
      heroFormEl={
        <LoginForm {...formProps} formId="kc-form-login" autoFocusInput />
      }
      bottomFormEl={
        <LoginForm
          {...formProps}
          formId="kc-form-login-bottom"
          autoFocusInput={false}
          dividerBgClass="bg-muted/30"
        />
      }
      providerButtons={providerButtons}
    />
  );
}

/* ── Reusable login form (matches the old design's Button/Input/Label) ── */

function LoginForm({
  formId,
  autoFocusInput,
  url,
  realm,
  login,
  auth,
  usernameHidden,
  usernameError,
  usernameLabel,
  messagesPerField,
  isSsoOnly,
  isSubmitting,
  setIsSubmitting,
  providerButtons,
  dividerBgClass = "bg-background",
  msgStr,
  msg,
}: {
  formId: string;
  autoFocusInput: boolean;
  url: LoginContext["url"];
  realm: LoginContext["realm"];
  login: LoginContext["login"];
  auth: LoginContext["auth"];
  usernameHidden: LoginContext["usernameHidden"];
  usernameError: boolean;
  usernameLabel: React.ReactNode;
  messagesPerField: LoginContext["messagesPerField"];
  isSsoOnly: boolean;
  isSubmitting: boolean;
  setIsSubmitting: (v: boolean) => void;
  providerButtons: React.ReactNode[];
  dividerBgClass?: string;
  msgStr: I18n["msgStr"];
  msg: I18n["msg"];
}) {
  return (
    <>
      {!isSsoOnly && realm.password && (
        <form
          id={formId}
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
              <Label htmlFor={`${formId}-username`}>{usernameLabel}</Label>
              <Input
                id={`${formId}-username`}
                name="username"
                type="text"
                autoFocus={autoFocusInput}
                autoComplete="username"
                placeholder="you@example.com"
                tabIndex={2}
                defaultValue={login.username ?? ""}
                aria-invalid={usernameError}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={`${formId}-password`}>{msg("password")}</Label>
            <Input
              id={`${formId}-password`}
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
              className="block text-[14px] text-red-600 dark:text-red-400"
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
        <div className="space-y-2">{providerButtons}</div>
      ) : (
        providerButtons.length > 0 && (
          <div>
            {realm.password && (
              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-input" />
                </div>
                <div className="relative flex justify-center">
                  <span className={`${dividerBgClass} px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground`}>
                    Or
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-2">{providerButtons}</div>
          </div>
        )
      )}
    </>
  );
}

/* ── Full scrolling page ───────────────────────────────────────────── */

function ScrollPage({
  kcContext,
  heroFormEl,
  bottomFormEl,
  providerButtons,
}: {
  kcContext: LoginContext;
  heroFormEl: React.ReactNode;
  bottomFormEl: React.ReactNode;
  providerButtons: React.ReactNode;
}) {
  useApplyThemeScript();

  const showMessage =
    kcContext.message !== undefined &&
    (kcContext.message.type !== "warning" || !kcContext.isAppInitiatedAction);

  return (
    <div className="min-h-screen snap-y snap-proximity bg-background" style={{ overflowY: "auto", overflowX: "hidden", height: "100dvh" }}>
      <section className="relative min-h-screen snap-start overflow-hidden">
        <div className="hidden lg:block">
          <HeroBgShapes />
        </div>

        <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center md:flex">
          <div className="w-[140%] max-w-[860px] -ml-[8%] pr-10">
            <SlackDmIllustration />
          </div>
        </div>

        <div className="relative z-10 flex min-h-screen items-center">
          <HeroLeft
            kcContext={kcContext}
            message={
              showMessage && kcContext.message ? (
                <div
                  role="alert"
                  className={cn(
                    "rounded-md border px-3 py-2 text-[14px]",
                    kcContext.message.type === "error"
                      ? "border-red-200 bg-red-50 text-red-800"
                      : "border-blue-200 bg-blue-50 text-blue-800",
                  )}
                  dangerouslySetInnerHTML={{
                    __html: kcSanitize(kcContext.message.summary),
                  }}
                />
              ) : null
            }
            heroFormEl={heroFormEl}
          />
        </div>

        <div className="absolute bottom-8 left-0 right-0 z-20 text-center">
          <button
            type="button"
            className="mx-auto inline-flex h-[35px] items-center gap-1.5 rounded-full border border-input bg-background px-3 text-[14px] font-normal text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-colors hover:bg-muted"
            onClick={() => {
              document
                .getElementById("info-bands")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            <span>Learn more</span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 32 32"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M16 28l-7-7 1.414-1.414L16 25.172l5.586-5.586L23 21l-7 7zM16 21l-7-7 1.414-1.414L16 18.172l5.586-5.586L23 14l-7 7z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </section>

      <div id="info-bands" className="overflow-x-hidden">
        <BandCapabilities brandName={kcContext.realm.displayName || "Platform"} />
        <BandChannels />
        <BandSandbox />
        <BandDevOps />
        <BandIntegrations />
        <BandTestimonials brandName={kcContext.realm.displayName || "Platform"} />
        <BandAccess
          formEl={bottomFormEl}
          characters={<InteractiveCharacterWidget />}
        />
      </div>
    </div>
  );
}

/* ── Hero left column ──────────────────────────────────────────────── */

function HeroLeft({
  kcContext,
  message,
  heroFormEl,
}: {
  kcContext: LoginContext;
  message: ReactNode;
  heroFormEl: ReactNode;
}) {
  return (
    <div className="flex w-full justify-center px-6 md:w-1/2">
      <div className="max-w-sm space-y-6">
        <p className="text-7xl font-light leading-[0.95] -tracking-[0.04em] text-foreground">
          Deploy Agents Massively
        </p>
        {message}
        {heroFormEl}
      </div>
    </div>
  );
}

/* ── Footer links ──────────────────────────────────────────────────── */

function LoginLinks({ className }: { className?: string }) {
  return (
    <div className={className}>
      <a
        href={LOGIN_DOCS_URL}
        target="_blank"
        rel="noreferrer noopener"
        className="text-[15px] text-accent hover:underline"
      >
        Read the docs
      </a>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        Questions? Ask in{" "}
        <a
          href="https://ibm.enterprise.slack.com/archives/C07PDAWV0QG"
          target="_blank"
          rel="noreferrer noopener"
          className="font-medium text-foreground hover:underline"
        >
          #dam-community
        </a>{" "}
        on Slack.
      </p>
    </div>
  );
}
