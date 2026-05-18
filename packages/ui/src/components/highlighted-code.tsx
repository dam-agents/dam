import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { useMemo } from "react";

hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("go", go);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("dockerfile", dockerfile);

const extToLang: Record<string, string> = {
  json: "json",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  yaml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  css: "css",
  html: "xml",
  xml: "xml",
  svg: "xml",
  go: "go",
  sql: "sql",
  dockerfile: "dockerfile",
};

function langFromPath(path: string): string | undefined {
  const filename = path.split("/").pop() ?? "";
  if (filename.toLowerCase() === "dockerfile") return "dockerfile";
  const ext = filename.split(".").pop()?.toLowerCase();
  return ext ? extToLang[ext] : undefined;
}

export function HighlightedCode({
  code,
  path,
}: {
  code: string;
  path: string;
}) {
  const html = useMemo(() => {
    const lang = langFromPath(path);
    if (lang) {
      try {
        return hljs.highlight(code, { language: lang }).value;
      } catch {}
    }
    return null;
  }, [code, path]);

  if (html) {
    return (
      <pre className="text-[12px] leading-[1.65] font-mono text-text whitespace-pre tab-[2]">
        <code
          className="hljs"
          style={{ background: "transparent" }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </pre>
    );
  }

  return (
    <pre className="text-[12px] leading-[1.65] font-mono text-text whitespace-pre tab-[2]">
      {code}
    </pre>
  );
}
