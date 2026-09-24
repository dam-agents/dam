import type { SatelliteTool } from "api-server-api";

export function SatelliteTools({ tools }: { tools: SatelliteTool[] }) {
  return (
    <ul className="flex flex-col gap-3 border-t border-border px-4 py-3">
      {tools.map((tool) => (
        <li key={tool.name} className="flex flex-col gap-1">
          <code className="text-sm text-foreground">{tool.name}</code>
          {(tool.description ?? tool.title) && (
            <p className="whitespace-pre-wrap font-mono text-xs text-muted-foreground">
              {tool.description ?? tool.title}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
