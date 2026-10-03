import type { KcContext } from "../login/KcContext.js";

type LoginContext = Extract<KcContext, { pageId: "login.ftl" }>;

const BASE: LoginContext = {
  themeType: "login",
  themeName: "platform",
  pageId: "login.ftl",
  locale: {
    currentLanguageTag: "en",
    supported: [{ languageTag: "en", label: "English", url: "#" }],
  },
  realm: {
    name: "platform",
    displayName: "DAM",
    displayNameHtml: "DAM",
    internationalizationEnabled: true,
    loginWithEmailAllowed: true,
    registrationEmailAsUsername: true,
    password: true,
    resetPasswordAllowed: true,
    registrationAllowed: false,
    rememberMe: false,
    editUsernameAllowed: false,
  },
  url: {
    loginAction: "#login-action",
    resourcesPath: "",
    loginUrl: "#login",
    loginResetCredentialsUrl: "#reset",
    registrationUrl: "#register",
    resourcesCommonPath: "",
    loginRestartFlowUrl: "#restart",
    ssoLoginInOtherTabsUrl: "#sso-other",
  },
  login: {
    username: "",
  },
  usernameHidden: false,
  auth: {
    selectedCredential: "",
  },
  social: {
    displayInfo: true,
    providers: [
      {
        alias: "w3id",
        displayName: "IBM w3id",
        loginUrl: "#sso-w3id",
        providerId: "oidc",
      },
    ],
  },
  scripts: [],
  message: undefined,
  isAppInitiatedAction: false,
  messagesPerField: {
    existsError: () => false,
    getFirstError: () => "",
    exists: () => false,
    get: () => "",
    printIfExists: <T,>(key: string, x: T) => (undefined as T | undefined),
  },
  client: {
    clientId: "platform-ui",
    name: "Platform UI",
    description: "",
    baseUrl: "#",
  },
  properties: {
    PLATFORM_ALLOW_PASSWORD: "true",
    PLATFORM_REQUEST_ACCESS_URL: "https://ibm.biz/dam-access",
    PLATFORM_SHARE_CLIENT_ID: "platform-share",
  },
} as unknown as LoginContext;

export const SIGN_IN: LoginContext = { ...BASE };

export const SSO_ONLY: LoginContext = {
  ...BASE,
  properties: {
    ...BASE.properties,
    PLATFORM_ALLOW_PASSWORD: "false",
  },
} as unknown as LoginContext;

export const WRONG_PASSWORD: LoginContext = {
  ...BASE,
  message: {
    type: "error",
    summary: "Invalid username or password.",
  },
  messagesPerField: {
    existsError: (...keys: string[]) =>
      keys.includes("username") || keys.includes("password"),
    getFirstError: () => "Invalid username or password.",
    exists: (key: string) => key === "username" || key === "password",
    get: () => "Invalid username or password.",
    printIfExists: <T,>(_key: string, x: T) => x,
  },
} as unknown as LoginContext;

export const SHARE_ARTIFACT: LoginContext = {
  ...BASE,
  client: {
    ...BASE.client,
    clientId: "platform-share",
  },
} as unknown as LoginContext;

export const ALL_SCENARIOS = {
  "Sign In": SIGN_IN,
  "SSO Only": SSO_ONLY,
  "Wrong Password": WRONG_PASSWORD,
  "Share Artifact": SHARE_ARTIFACT,
} as const;
