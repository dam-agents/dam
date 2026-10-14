import "@git-diff-view/react/styles/diff-view-pure.css";

import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView, getLang } from "@git-diff-view/react";
import { useMemo } from "react";

import { TruncateStart } from "@/components/truncate-start";
import { CopyButton } from "@/components/ui/copy-button";
import { HOVER_ACTION } from "@/components/ui/hover-action";
import { cn } from "@/lib/utils";
import { isDarkTheme } from "@/modules/platform/store/theme";
import { useStore } from "@/store";

export function ToolDiffBlock({
  path,
  oldText,
  newText,
}: {
  path: string;
  oldText: string | null;
  newText: string;
}) {
  const theme = useStore((s) => (isDarkTheme(s.theme) ? "dark" : "light"));
  const diffFile = useMemo(() => {
    const lang = getLang(path);
    const file = generateDiffFile(
      path,
      oldText ?? "",
      path,
      newText,
      lang,
      lang,
    );
    file.init();
    file.buildUnifiedDiffLines();
    return file;
  }, [path, oldText, newText]);

  return (
    <div className="group/content relative my-1 rounded bg-muted/40 border border-border/40 overflow-hidden">
      <div className="flex items-center gap-2 px-2 py-1.5 pr-8 text-2xs font-mono min-w-0">
        <TruncateStart title={path} className="min-w-0 text-foreground/90">
          {path}
        </TruncateStart>
        {oldText === null && (
          <span className="shrink-0 text-muted-foreground">new file</span>
        )}
        <span className="shrink-0 text-success">
          +{diffFile.additionLength}
        </span>
        <span className="shrink-0 text-danger">-{diffFile.deletionLength}</span>
      </div>
      <div className="max-h-[32rem] overflow-auto border-t border-border/40 select-text">
        <DiffView
          diffFile={diffFile}
          diffViewMode={DiffModeEnum.Unified}
          diffViewTheme={theme}
          diffViewHighlight
          diffViewWrap
          diffViewFontSize={11}
        />
      </div>
      <CopyButton
        value={newText}
        label="Copy new content"
        stopPropagation
        className={cn("absolute right-1 top-1", HOVER_ACTION)}
      />
    </div>
  );
}
