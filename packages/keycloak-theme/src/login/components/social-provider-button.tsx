import { kcSanitize } from "keycloakify/lib/kcSanitize";

import { BASE_URL } from "../../kc.gen";

const IBM_SSO_ALIASES = ["w3id", "ibmid"];

interface SocialProvider {
  alias: string;
  loginUrl: string;
  displayName: string;
  iconClasses?: string;
}

interface Props {
  provider: SocialProvider;
}

function isIbmProvider({ alias, iconClasses }: SocialProvider) {
  return IBM_SSO_ALIASES.some(
    (ibmAlias) =>
      alias.toLowerCase() === ibmAlias || iconClasses?.includes(ibmAlias),
  );
}

export function SocialProviderButton({ provider }: Props) {
  const isIbm = isIbmProvider(provider);

  return (
    <a
      id={`social-${provider.alias}`}
      href={provider.loginUrl}
      className="border-accent bg-background text-accent hover:bg-muted focus-visible:ring-ring inline-flex h-[60px] w-[var(--width-login-col)] max-w-full items-center justify-start gap-3 rounded-md border px-8 text-[20px] font-semibold whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {isIbm && (
        <img
          src={`${BASE_URL}ibm-logo.svg`}
          alt=""
          className="h-5 w-auto shrink-0"
        />
      )}
      <span
        dangerouslySetInnerHTML={{ __html: kcSanitize(provider.displayName) }}
      />
    </a>
  );
}
