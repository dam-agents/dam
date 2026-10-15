import { Markdown } from "@/components/markdown";
import { cn } from "@/lib/utils";

interface Props {
  text: string;
  caption?: boolean;
}

export function A2uiMarkdown({ text, caption = false }: Props) {
  return (
    <div className="min-w-0">
      <Markdown className={cn("prose-flush", caption && "prose-caption")}>
        {text}
      </Markdown>
    </div>
  );
}
