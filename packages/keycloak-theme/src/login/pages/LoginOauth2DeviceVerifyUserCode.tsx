import type { PageProps } from "keycloakify/login/pages/PageProps";
import { useState } from "react";

import { Button } from "../../components/button.js";
import { Input } from "../../components/input.js";
import { Label } from "../../components/label.js";
import type { I18n } from "../i18n.js";
import type { KcContext } from "../KcContext.js";

export default function LoginOauth2DeviceVerifyUserCode(
  props: PageProps<
    Extract<KcContext, { pageId: "login-oauth2-device-verify-user-code.ftl" }>,
    I18n
  >,
) {
  const { kcContext, i18n, doUseDefaultCss, Template, classes } = props;
  const { url } = kcContext;
  const { msg, msgStr } = i18n;

  const [isSubmitting, setIsSubmitting] = useState(false);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      headerNode={msg("oauth2DeviceVerificationTitle")}
    >
      <form
        id="kc-user-verify-device-user-code-form"
        className="space-y-4"
        onSubmit={() => {
          setIsSubmitting(true);
          return true;
        }}
        action={url.oauth2DeviceVerificationAction}
        method="post"
      >
        <div className="space-y-2">
          <Label htmlFor="device-user-code">
            {msg("verifyOAuth2DeviceUserCode")}
          </Label>
          <Input
            id="device-user-code"
            name="device_user_code"
            type="text"
            autoComplete="off"
            autoFocus
          />
        </div>

        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={isSubmitting}
        >
          {msgStr("doSubmit")}
        </Button>
      </form>
    </Template>
  );
}
