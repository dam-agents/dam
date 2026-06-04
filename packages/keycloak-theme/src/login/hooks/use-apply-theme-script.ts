import { useInsertScriptTags } from "keycloakify/tools/useInsertScriptTags";
import { useEffect } from "react";

// STORAGE_KEY + VALID duplicate THEME_STORAGE_KEY + themeSchema in
// packages/ui/src/modules/platform/store/theme.ts. The duplication is
// load-bearing: keycloakify pins to React 18 (keycloakify#998) and
// packages/ui is on React 19, so they can't share a contract package.
// If you change one side, update the other.
const STORAGE_KEY = "platform-theme";
const URL_PARAM = "kc_theme";
const VALID = ["light", "dark", "system"] as const;

/**
 * Cross-domain dark-mode handoff (ADR-054).
 *
 * The dam UI runs on a different host than Keycloak, so localStorage is not
 * shared. When the UI redirects to Keycloak it appends ?kc_theme=...; this
 * script reads that param (and falls back to Keycloak-domain localStorage,
 * then OS preference) and toggles `.dark` on <html>. The script is inserted
 * inside `useEffect`, so it runs after the first React commit; the body's
 * paintable surface is driven entirely by CSS custom properties, so the
 * worst case is a brief light-palette flash on a dark-mode user's first
 * paint. Matches adk's pattern.
 */
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
