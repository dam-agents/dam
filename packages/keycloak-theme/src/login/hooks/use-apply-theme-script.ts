import { useInsertScriptTags } from "keycloakify/tools/useInsertScriptTags";
import { useEffect } from "react";

export function useApplyThemeScript() {
  const script = `
(() => {
  document.documentElement.classList.remove('dark');
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
