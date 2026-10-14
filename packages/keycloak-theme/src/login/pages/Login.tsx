import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { type ReactNode, useState } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import { cn } from "../../lib/cn.js";
import { StackedCharacters } from "../components/animated-characters.js";
import { HeroBgShapes } from "../components/hero-bg-shapes.js";
import {
  BandAccess,
  BandCapabilities,
  BandChannels,
  BandFaq,
} from "../components/info-bands.js";
import { SlackDmIllustration } from "../components/slack-dm-illustration.js";
import { SocialProviderButton } from "../components/social-provider-button.js";
import { useApplyThemeScript } from "../hooks/use-apply-theme-script.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";
import { BRAND_FALLBACK } from "../Template.js";

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
  const requestAccessUrl = kcContext.properties.PLATFORM_REQUEST_ACCESS_URL;
  const isShareSignIn =
    kcContext.client.clientId === kcContext.properties.PLATFORM_SHARE_CLIENT_ID;
  const brand = realm.displayName || BRAND_FALLBACK;
  const providerButtons = providers.map((p) => (
    <SocialProviderButton key={p.alias} provider={p} />
  ));

  const showBands = !isShareSignIn;

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
        <LoginForm {...formProps} formId="kc-form-login" autoFocusInput />
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

  return (
    <ScrollPage
      kcContext={kcContext}
      brand={brand}
      heroFormEl={
        <LoginForm {...formProps} formId="kc-form-login" autoFocusInput />
      }
      bottomFormEl={
        <LoginForm
          {...formProps}
          formId="kc-form-login-bottom"
          autoFocusInput={false}
        />
      }
      requestAccessUrl={requestAccessUrl}
    />
  );
}

function ScrollPage({
  kcContext,
  brand,
  heroFormEl,
  bottomFormEl,
  requestAccessUrl,
}: {
  kcContext: LoginContext;
  brand: string;
  heroFormEl: React.ReactNode;
  bottomFormEl: React.ReactNode;
  requestAccessUrl: string;
}) {
  useApplyThemeScript();
  const [layout, setLayout] = useState(0);

  const showMessage =
    kcContext.message !== undefined &&
    (kcContext.message.type !== "warning" || !kcContext.isAppInitiatedAction);

  return (
    <div className="min-h-screen bg-background">
      <LayoutPicker current={layout} onChange={setLayout} />

      {/* Hero — sign-in form + marketing column */}
      <section className="relative min-h-screen overflow-hidden">
        <HeroBgShapes />

        {/* Slack illustration — right half, floats above shapes */}
        <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center md:flex">
          <div className="w-[140%] max-w-[860px] -ml-[8%] pr-10">
            <SlackDmIllustration />
          </div>
        </div>

        <div className="relative z-10 flex min-h-screen items-center">
          <HeroLeft
            layout={layout}
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
            formEl={heroFormEl}
            requestAccessUrl={requestAccessUrl}
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
            <span>What is DAM?</span>
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

      <div id="info-bands">
        <BandCapabilities />
        <BandChannels />
        <BandFaq />
        <BandAccess
          requestAccessUrl={requestAccessUrl}
          formEl={bottomFormEl}
          characters={<StackedCharacters />}
        />
      </div>
    </div>
  );
}

const LOGIN_DOCS_LINK = (
  <a
    href={LOGIN_DOCS_URL}
    target="_blank"
    rel="noreferrer noopener"
    className="text-accent hover:underline"
  >
    Read the docs.
  </a>
);

const LAYOUTS = [
  "Stacked narrow",
  "Wide headline",
  "Side-by-side",
  "Compact centered",
  "Headline + columns",
] as const;

function HeroLeft({
  layout,
  message,
  formEl,
  requestAccessUrl,
}: {
  layout: number;
  message: ReactNode;
  formEl: ReactNode;
  requestAccessUrl: string;
}) {
  const accessLink = requestAccessUrl && (
    <p>
      <a
        href={requestAccessUrl}
        className="text-[15px] text-accent hover:underline"
      >
        Request access
      </a>
    </p>
  );

  const headline = (
    <p className="text-7xl font-light leading-[0.95] -tracking-[0.04em] text-foreground">
      Deploy Agents Massively
    </p>
  );

  const sub = (
    <p className="text-[15px] leading-relaxed text-pretty text-muted-foreground">
      Each agent runs in its own sandbox, keeps its files, and keeps working
      after you log off. Connect the tools you already use, and hand off the
      work. {LOGIN_DOCS_LINK}
    </p>
  );

  if (layout === 1) {
    return (
      <div className="flex w-full items-center justify-center px-6 md:w-1/2">
        <div className="max-w-md space-y-6">
          {headline}
          {message}
          {sub}
          {formEl}
          {accessLink}
        </div>
      </div>
    );
  }

  if (layout === 2) {
    return (
      <div className="flex w-full justify-start px-10 md:w-[55%]">
        <div className="w-full max-w-lg space-y-6">
          {headline}
          {message}
          <div className="flex gap-8">
            <div className="flex-1 space-y-1">{sub}</div>
            <div className="w-[260px] shrink-0 space-y-4">
              {formEl}
              {accessLink}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (layout === 3) {
    return (
      <div className="flex w-full justify-center px-6 md:w-1/2">
        <div className="max-w-xs space-y-5 text-center">
          <p className="text-6xl font-light leading-[0.95] -tracking-[0.04em] text-foreground">
            Deploy Agents Massively
          </p>
          {message}
          <p className="text-[14px] leading-relaxed text-pretty text-muted-foreground">
            Each agent runs in its own sandbox, keeps its files, and keeps
            working after you log off. Connect the tools you already use, and
            hand off the work. {LOGIN_DOCS_LINK}
          </p>
          {formEl}
          {accessLink}
        </div>
      </div>
    );
  }

  if (layout === 4) {
    return (
      <div className="flex w-full justify-start px-10 md:w-[55%]">
        <div className="w-full max-w-lg space-y-5">
          {headline}
          {message}
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              {sub}
              {accessLink}
            </div>
            <div className="space-y-4">{formEl}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-center px-6 md:w-1/2">
      <div className="max-w-sm space-y-6">
        {headline}
        {message}
        {sub}
        {formEl}
        {accessLink}
      </div>
    </div>
  );
}

function LayoutPicker({
  current,
  onChange,
}: {
  current: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-1 rounded-lg border border-input bg-background/90 p-2 shadow-lg backdrop-blur-sm">
      <span className="px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Layout
      </span>
      <div className="flex gap-1">
        {LAYOUTS.map((label, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange(i)}
            className={`flex size-7 items-center justify-center rounded text-[13px] font-medium transition-colors ${
              i === current
                ? "bg-foreground text-background"
                : "bg-muted text-foreground hover:bg-muted-foreground/20"
            }`}
            title={label}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <span className="px-1 text-[11px] text-muted-foreground">
        {LAYOUTS[current]}
      </span>
    </div>
  );
}

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
              className="block text-[14px] text-red-600"
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
        <div className="space-y-2">
          {providerButtons}
        </div>
      ) : (
        providerButtons.length > 0 && (
          <div>
            {realm.password && (
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
            )}

            <div className="space-y-2">{providerButtons}</div>
          </div>
        )
      )}
    </>
  );
}
