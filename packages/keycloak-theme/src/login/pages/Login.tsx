import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import { cn } from "../../lib/cn.js";
import { HeroBgShapes } from "../components/hero-bg-shapes.js";
import { MessageAlert } from "../components/message-alert.js";
import { NameMeaningHeading } from "../components/name-meaning-heading.js";
import { ScaledStage } from "../components/scaled-stage.js";
import { AccessSection } from "../components/sections/access.js";
import { CapabilitiesSection } from "../components/sections/capabilities.js";
import { ChannelsSection } from "../components/sections/channels.js";
import { DevOpsSection } from "../components/sections/devops.js";
import { SandboxSection } from "../components/sections/sandbox.js";
import { TestimonialsSection } from "../components/sections/testimonials.js";
import { SlackDmIllustration } from "../components/slack-dm-illustration.js";
import { SocialProviderButton } from "../components/social-provider-button.js";
import type { LoginContent } from "../content.js";
import { readLoginContent, useTestimonials } from "../content.js";
import {
  BRAND_FALLBACK,
  showsMessage,
  useLoginPageSetup,
} from "../hooks/use-login-page-setup.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

type LoginContext = Extract<KcContext, { pageId: "login.ftl" }>;

const PRIMARY_FORM_ID = "kc-form-login";

export default function Login(props: PageProps<LoginContext, I18n>) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { social, realm, messagesPerField } = kcContext;

  const [isSubmitting, setIsSubmitting] = useState(false);

  const usernameError = messagesPerField.existsError("username", "password");
  const providers = social?.providers ?? [];
  const isSsoOnly =
    kcContext.properties.PLATFORM_ALLOW_PASSWORD === "false" &&
    providers.length > 0;
  const isShareSignIn =
    kcContext.client.clientId === kcContext.properties.PLATFORM_SHARE_CLIENT_ID;
  const brand = realm.displayName || BRAND_FALLBACK;
  const content = readLoginContent(kcContext.properties);

  const form: LoginFormShared = {
    kcContext,
    i18n,
    usernameError,
    isSsoOnly,
    isSubmitting,
    onSubmit: () => setIsSubmitting(true),
    providerButtons: providers.map((p) => (
      <SocialProviderButton key={p.alias} provider={p} />
    )),
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
        <p className="mt-6 text-base leading-relaxed text-pretty md:text-xl">
          You're not signed in. Please sign in with your account to view the
          artifact.
        </p>
        <div className="mt-12 max-w-[var(--width-login-col)]">
          <LoginForm {...form} formId={PRIMARY_FORM_ID} autoFocusInput />
        </div>
      </Template>
    );
  }

  return (
    <ScrollPage
      kcContext={kcContext}
      i18n={i18n}
      brand={brand}
      content={content}
      showMessage={!usernameError}
      doUseDefaultCss={doUseDefaultCss}
      heroForm={<LoginForm {...form} formId={PRIMARY_FORM_ID} autoFocusInput />}
      bottomForm={
        <LoginForm
          {...form}
          formId="kc-form-login-bottom"
          autoFocusInput={false}
          dividerBgClass="bg-section"
        />
      }
    />
  );
}

type LoginFormShared = {
  kcContext: LoginContext;
  i18n: I18n;
  usernameError: boolean;
  isSsoOnly: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  providerButtons: React.ReactNode[];
};

type LoginFormProps = LoginFormShared & {
  formId: string;
  autoFocusInput: boolean;
  dividerBgClass?: string;
};

function LoginForm({
  kcContext,
  i18n,
  usernameError,
  isSsoOnly,
  isSubmitting,
  onSubmit,
  providerButtons,
  formId,
  autoFocusInput,
  dividerBgClass = "bg-background",
}: LoginFormProps) {
  const { realm, url, usernameHidden, login, auth, messagesPerField } =
    kcContext;
  const { msg, msgStr } = i18n;

  const fieldId = (name: string) =>
    formId === PRIMARY_FORM_ID ? name : `${formId}-${name}`;
  const usernameLabel = !realm.loginWithEmailAllowed
    ? msg("username")
    : !realm.registrationEmailAsUsername
      ? msg("usernameOrEmail")
      : msg("email");

  return (
    <>
      {!isSsoOnly && realm.password && (
        <form
          id={formId}
          className="space-y-4"
          onSubmit={() => {
            onSubmit();
            return true;
          }}
          action={url.loginAction}
          method="post"
        >
          {!usernameHidden && (
            <div className="space-y-2">
              <Label htmlFor={fieldId("username")}>{usernameLabel}</Label>
              <Input
                id={fieldId("username")}
                name="username"
                type="text"
                autoFocus={autoFocusInput}
                autoComplete="username"
                placeholder="you@example.com"
                defaultValue={login.username ?? ""}
                aria-invalid={usernameError}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor={fieldId("password")}>{msg("password")}</Label>
            <Input
              id={fieldId("password")}
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              aria-invalid={usernameError}
            />
          </div>

          {usernameError && (
            <span
              role="alert"
              aria-live="polite"
              className="block text-sm text-red-600 dark:text-red-400"
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
          >
            {msgStr("doLogIn")}
          </Button>
        </form>
      )}

      {isSsoOnly ? (
        <div className="space-y-2">{providerButtons}</div>
      ) : (
        providerButtons.length > 0 && (
          <div className="mt-4">
            {realm.password && (
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="border-input w-full border-t" />
                </div>
                <div className="relative flex justify-center">
                  <span
                    className={cn(
                      dividerBgClass,
                      "text-muted-foreground px-2 text-[11px] font-medium tracking-wide uppercase",
                    )}
                  >
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

function ScrollPage({
  kcContext,
  i18n,
  brand,
  content,
  showMessage,
  doUseDefaultCss,
  heroForm,
  bottomForm,
}: {
  kcContext: LoginContext;
  i18n: I18n;
  brand: string;
  content: LoginContent;
  showMessage: boolean;
  doUseDefaultCss: boolean;
  heroForm: React.ReactNode;
  bottomForm: React.ReactNode;
}) {
  const testimonials = useTestimonials(kcContext.properties.PLATFORM_API_URL);
  const { isReadyToRender, nameMeaning } = useLoginPageSetup({
    kcContext,
    i18n,
    doUseDefaultCss,
  });
  if (!isReadyToRender) return null;

  const alert =
    showsMessage(kcContext, showMessage) && kcContext.message ? (
      <MessageAlert message={kcContext.message} />
    ) : null;

  return (
    <div className="bg-background h-dvh snap-y snap-proximity overflow-x-hidden overflow-y-auto">
      <section className="relative min-h-dvh snap-start overflow-hidden">
        <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center md:flex">
          <div className="-ml-[8%] w-[140%] max-w-[860px] pr-10">
            <ScaledStage width={820} height={520}>
              <HeroBgShapes />
              <div className="relative h-full">
                <SlackDmIllustration brand={brand} still />
              </div>
            </ScaledStage>
          </div>
        </div>

        <div className="relative z-10 flex min-h-dvh items-center py-24">
          <div className="flex w-full justify-center px-6 md:w-1/2">
            <div className="w-full max-w-[var(--width-login-col)] space-y-6">
              {nameMeaning ? (
                <NameMeaningHeading
                  meaning={nameMeaning}
                  className="text-foreground relative z-20 text-5xl leading-[1.2] font-light -tracking-[0.04em] md:text-7xl"
                />
              ) : (
                <h1 className="text-foreground text-5xl leading-[0.95] font-light -tracking-[0.04em] md:text-7xl">
                  {brand}
                </h1>
              )}
              <p className="text-muted-foreground text-lg">
                Work better with AI agent teammates.
              </p>
              {alert}
              {heroForm}
            </div>
          </div>
        </div>

        <div className="absolute right-0 bottom-8 left-0 z-20 text-center">
          <button
            type="button"
            className="border-input bg-background text-foreground hover:bg-muted mx-auto inline-flex h-[35px] items-center gap-1.5 rounded-full border px-3 text-sm shadow-[0_1px_2px_rgba(0,0,0,0.08)] transition-colors"
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
        <CapabilitiesSection brand={brand} docsUrl={content.docsUrl} />
        <ChannelsSection brand={brand} />
        <TestimonialsSection brand={brand} testimonials={testimonials} />
        <SandboxSection />
        <DevOpsSection />
        <AccessSection
          form={bottomForm}
          docsUrl={content.docsUrl}
          community={content.community}
        />
      </div>
    </div>
  );
}
