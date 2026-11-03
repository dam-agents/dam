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
    printIfExists: <T>(_key: string, _x: T) => undefined as T | undefined,
  },
  client: {
    clientId: "platform-ui",
    name: "Platform UI",
    description: "",
    baseUrl: "#",
  },
  properties: {
    PLATFORM_ALLOW_PASSWORD: "true",
    PLATFORM_SHARE_CLIENT_ID: "platform-share",
    PLATFORM_BRAND_NAME_MEANINGS: '["Deploy Agents Massively"]',
    PLATFORM_LOGIN_DOCS_URL: "https://ibm.biz/dam-docs",
    PLATFORM_LOGIN_COMMUNITY_LABEL: "#dam-community",
    PLATFORM_LOGIN_COMMUNITY_URL:
      "https://ibm.enterprise.slack.com/archives/C07PDAWV0QG",
    PLATFORM_API_URL: "/preview-api",
  },
  "x-keycloakify": {
    messages: {},
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

export const NO_CONTENT: LoginContext = {
  ...BASE,
  properties: {
    ...BASE.properties,
    PLATFORM_LOGIN_DOCS_URL: "",
    PLATFORM_LOGIN_COMMUNITY_LABEL: "",
    PLATFORM_LOGIN_COMMUNITY_URL: "",
    PLATFORM_API_URL: "/preview-api/empty",
  },
} as unknown as LoginContext;

export const BAD_TESTIMONIALS: LoginContext = {
  ...BASE,
  properties: {
    ...BASE.properties,
    PLATFORM_API_URL: "/preview-api/broken",
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
    printIfExists: <T>(_key: string, x: T) => x,
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
  "sign-in": SIGN_IN,
  "sso-only": SSO_ONLY,
  "no-content": NO_CONTENT,
  "bad-testimonials": BAD_TESTIMONIALS,
  "wrong-password": WRONG_PASSWORD,
  "share-artifact": SHARE_ARTIFACT,
} as const;
