import { kcSanitize } from "keycloakify/lib/kcSanitize";

import { BASE_URL } from "../../kc.gen";

const IBM_SSO_ALIAS = "w3id";

interface SocialProvider {
  alias: string;
  loginUrl: string;
  displayName: string;
  iconClasses?: string;
}

interface Props {
  provider: SocialProvider;
}

export function SocialProviderButton({ provider }: Props) {
  const isIbm =
    provider.alias === IBM_SSO_ALIAS ||
    provider.iconClasses?.includes(IBM_SSO_ALIAS);

  return (
    <a
      id={`social-${provider.alias}`}
      href={provider.loginUrl}
      className="border-input bg-background hover:bg-muted focus-visible:ring-ring inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border px-8 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {isIbm && (
        <img
          src={`${BASE_URL}ibm-logo.svg`}
          alt=""
          className="h-2.5 w-auto shrink-0"
        />
      )}
      <span
        dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }}
      />
    </a>
  );
}
