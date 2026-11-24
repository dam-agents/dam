export function ArgumentsBlock({ text }: { text: string }) {
  return (
    <pre className="m-0 max-h-60 overflow-auto rounded-md border border-border/50 bg-muted/40 px-2.5 py-1.5 font-mono text-2xs leading-relaxed whitespace-pre-wrap break-all text-foreground/90">
      {text}
    </pre>
  );
}
