import { useInsertScriptTags } from "keycloakify/tools/useInsertScriptTags";
import { useEffect } from "react";

const STORAGE_KEY = "platform-theme";
const URL_PARAM = "kc_theme";
const VALID = ["light", "dark", "system"] as const;

export function useApplyThemeScript() {
  const script = `
(() => {
  try {
    const html = document.documentElement;
    const valid = ${JSON.stringify(VALID)};
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('${URL_PARAM}');

    let pref;
    if (fromUrl && valid.includes(fromUrl)) {
      pref = fromUrl;
      try { localStorage.setItem('${STORAGE_KEY}', pref); } catch (_) {}
    } else {
      try {
        const stored = localStorage.getItem('${STORAGE_KEY}');
        if (stored && valid.includes(stored)) pref = stored;
      } catch (_) {}
    }
    pref = pref || 'system';

    const isDark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    html.classList.toggle('dark', isDark);
  } catch (e) {
    console.warn('[keycloak-theme] theme apply failed', e);
  }
})();
`;

  const { insertScriptTags } = useInsertScriptTags({
    componentOrHookName: "useApplyThemeScript",
    scriptTags: [{ type: "text/javascript", textContent: script }],
  });

  useEffect(() => {
    insertScriptTags();
  }, [insertScriptTags]);
}
