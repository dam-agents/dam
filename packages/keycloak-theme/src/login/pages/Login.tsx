import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import { cn } from "../../lib/cn.js";
import { GrainDefs } from "../components/grain-defs.js";
import {
  BandAccess,
  BandChannels,
  BandFaq,
  BandJobs,
  BandLoop,
} from "../components/info-bands.js";
import { SocialProviderButton } from "../components/social-provider-button.js";
import { useApplyThemeScript } from "../hooks/use-apply-theme-script.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";
import { BRAND_FALLBACK } from "../Template.js";

type LoginContext = Extract<KcContext, { pageId: "login.ftl" }>;

const LOGIN_DOCS_URL = "https://ibm.biz/dam-docs";

export default function Login(
  props: PageProps<LoginContext, I18n>,
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
  const isSsoOnly =
    kcContext.properties.PLATFORM_ALLOW_PASSWORD === "false" &&
    providers.length > 0;
  const requestAccessUrl = kcContext.properties.PLATFORM_REQUEST_ACCESS_URL;
  const isShareSignIn =
    kcContext.client.clientId === kcContext.properties.PLATFORM_SHARE_CLIENT_ID;
  const brand = realm.displayName || BRAND_FALLBACK;
  const providerButtons = providers.map((p) => (
    <SocialProviderButton key={p.alias} provider={p} />
  ));

  const showBands = !isShareSignIn;

  const formEl = (
    <LoginForm
      url={url}
      realm={realm}
      login={login}
      auth={auth}
      usernameHidden={usernameHidden}
      usernameError={usernameError}
      usernameLabel={usernameLabel}
      messagesPerField={messagesPerField}
      isSsoOnly={isSsoOnly}
      isSubmitting={isSubmitting}
      setIsSubmitting={setIsSubmitting}
      providerButtons={providerButtons}
      msgStr={msgStr}
      msg={msg}
    />
  );

  // Share-artifact: simple single-column via Template, no bands.
  if (!showBands) {
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
        {formEl}
        {requestAccessUrl && (
          <p className="mt-16">
            <a
              href={requestAccessUrl}
              className="text-[15px] text-accent hover:underline"
            >
              Request access
            </a>
          </p>
        )}
      </Template>
    );
  }

  // Main login: two-column layout with scrolling info bands.
  return (
    <LoginWithBands
      kcContext={kcContext}
      formEl={formEl}
      requestAccessUrl={requestAccessUrl}
    />
  );
}

function LoginWithBands({
  kcContext,
  formEl,
  requestAccessUrl,
}: {
  kcContext: LoginContext;
  formEl: React.ReactNode;
  requestAccessUrl: string;
}) {
  useApplyThemeScript();

  const showMessage =
    kcContext.message !== undefined &&
    (kcContext.message.type !== "warning" || !kcContext.isAppInitiatedAction);

  return (
    <div className="min-h-screen bg-background">
      <GrainDefs />

      <div className="flex min-h-screen flex-col lg:flex-row">
        {/* Left column — sign-in, sticky at desktop */}
        <div className="shrink-0 px-6 pt-12 pb-8 lg:sticky lg:top-0 lg:h-screen lg:w-[480px] lg:overflow-y-auto lg:px-12 lg:py-12 xl:w-[540px]">
          <div className="max-w-[var(--width-login-col)]">
            <p className="text-base font-semibold tracking-tight">
              Deploy Agents Massively
            </p>
            <h1 className="mt-3 text-[32px] leading-[1.2] font-light tracking-[-0.03em] md:text-[40px] md:leading-[1.2] lg:text-[48px] lg:leading-[1.15]">
              Put an agent
              <br />
              on it.
            </h1>

            <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
              Give an AI agent a task and a schedule. It runs on its own and
              reports back.{" "}
              <a
                href={LOGIN_DOCS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                Learn more
              </a>
            </p>

            {showMessage && kcContext.message && (
              <div
                role="alert"
                className={cn(
                  "mt-6 rounded-md border px-3 py-2 text-sm",
                  kcContext.message.type === "error"
                    ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
                    : "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
                )}
                dangerouslySetInnerHTML={{
                  __html: kcSanitize(kcContext.message.summary),
                }}
              />
            )}

            {formEl}

            {/* Scroll hint — desktop only */}
            <button
              type="button"
              className="mt-10 hidden items-center gap-2 text-[14px] text-muted-foreground hover:text-foreground lg:flex"
              onClick={() => {
                document
                  .getElementById("info-bands")
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
            >
              <span>What is this?</span>
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 3v10m0 0l-3.5-3.5M8 13l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Divider — desktop only */}
        <div className="hidden lg:block lg:w-px lg:self-stretch lg:bg-input" />

        {/* Right column — scrolling info bands */}
        <div
          id="info-bands"
          className="flex-1 px-6 py-12 lg:overflow-y-auto lg:px-12 lg:py-16 xl:px-16"
        >
          <div className="max-w-[520px] space-y-16">
            <BandJobs />
            <BandLoop />
            <BandChannels />
            <BandFaq />
            <BandAccess requestAccessUrl={requestAccessUrl} />
          </div>
        </div>
      </div>
    </div>
  );
}

function LoginForm({
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
}: {
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
  msgStr: I18n["msgStr"];
  msg: I18n["msg"];
}) {
  return (
    <>
      {!isSsoOnly && realm.password && (
        <form
          id="kc-form-login"
          className="mt-8 max-w-[var(--width-login-col)] space-y-4"
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
        <div className="mt-10 max-w-[var(--width-login-col)] space-y-2">
          {providerButtons}
        </div>
      ) : (
        providerButtons.length > 0 && (
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

            <div className="space-y-2">{providerButtons}</div>
          </div>
        )
      )}
    </>
  );
}
