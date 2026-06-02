import DefaultPage from "keycloakify/login/DefaultPage";
import DefaultUserProfileFormFields from "keycloakify/login/UserProfileFormFields";
import { lazy, Suspense } from "react";

import { useI18n } from "./i18n.js";
import type { KcContext } from "./KcContext.js";
import Template from "./Template.js";

const Login = lazy(() => import("./pages/Login.js"));
const Error = lazy(() => import("./pages/Error.js"));
const Info = lazy(() => import("./pages/Info.js"));
const LoginOauth2DeviceVerifyUserCode = lazy(
  () => import("./pages/LoginOauth2DeviceVerifyUserCode.js"),
);
const LoginOauthGrant = lazy(() => import("./pages/LoginOauthGrant.js"));

const doMakeUserConfirmPassword = true;

export default function KcPage({ kcContext }: { kcContext: KcContext }) {
  const { i18n } = useI18n({ kcContext });

  return (
    <Suspense>
      {(() => {
        switch (kcContext.pageId) {
          case "login.ftl":
            return (
              <Login
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={false}
                Template={Template}
              />
            );
          case "error.ftl":
            return (
              <Error
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={false}
                Template={Template}
              />
            );
          case "info.ftl":
            return (
              <Info
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={false}
                Template={Template}
              />
            );
          case "login-oauth2-device-verify-user-code.ftl":
            return (
              <LoginOauth2DeviceVerifyUserCode
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={false}
                Template={Template}
              />
            );
          case "login-oauth-grant.ftl":
            return (
              <LoginOauthGrant
                kcContext={kcContext}
                i18n={i18n}
                doUseDefaultCss={false}
                Template={Template}
              />
            );
          default:
            return (
              <DefaultPage
                kcContext={kcContext}
                i18n={i18n}
                Template={Template}
                doUseDefaultCss={true}
                UserProfileFormFields={DefaultUserProfileFormFields}
                doMakeUserConfirmPassword={doMakeUserConfirmPassword}
              />
            );
        }
      })()}
    </Suspense>
  );
}
