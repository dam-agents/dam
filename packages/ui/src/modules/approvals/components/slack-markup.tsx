import { Fragment, useMemo } from "react";
import { match } from "ts-pattern";

import {
  parseSlackMarkup,
  type SlackBlock,
  type SlackInline,
  type SlackLine,
} from "../lib/slack-markup.js";

function Inline({ node }: { node: SlackInline }) {
  return match(node)
    .with({ kind: "text" }, ({ text }) => <>{text}</>)
    .with({ kind: "bold" }, ({ children }) => (
      <strong className="font-semibold">
        <Inlines nodes={children} />
      </strong>
    ))
    .with({ kind: "italic" }, ({ children }) => (
      <em>
        <Inlines nodes={children} />
      </em>
    ))
    .with({ kind: "strike" }, ({ children }) => (
      <s>
        <Inlines nodes={children} />
      </s>
    ))
    .with({ kind: "code" }, ({ text }) => (
      <code className="rounded border border-border/60 bg-muted/60 px-1 font-mono text-[0.85em] text-danger">
        {text}
      </code>
    ))
    .with({ kind: "link" }, ({ url, label, destination }) => (
      <>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent hover:underline"
        >
          {label}
        </a>
        {destination !== null && (
          <span
            data-testid="slack-link-destination"
            className="text-muted-foreground"
          >
            {" "}
            ({destination})
          </span>
        )}
      </>
    ))
    .with({ kind: "mention" }, ({ label }) => (
      <span className="rounded bg-accent-light px-0.5 text-accent">
        {label}
      </span>
    ))
    .exhaustive();
}

function Inlines({ nodes }: { nodes: SlackLine }) {
  return nodes.map((node, index) => <Inline key={index} node={node} />);
}

function Lines({ lines }: { lines: readonly SlackLine[] }) {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 && <br />}
      <Inlines nodes={line} />
    </Fragment>
  ));
}

function Block({ block }: { block: SlackBlock }) {
  return match(block)
    .with({ kind: "paragraph" }, ({ lines }) => (
      <p>
        <Lines lines={lines} />
      </p>
    ))
    .with({ kind: "quote" }, ({ lines }) => (
      <blockquote className="border-l-4 border-border pl-3">
        <Lines lines={lines} />
      </blockquote>
    ))
    .with({ kind: "list", ordered: true }, ({ start, items }) => (
      <ol start={start} className="list-decimal pl-5">
        {items.map((item, index) => (
          <li key={index}>
            <Inlines nodes={item} />
          </li>
        ))}
      </ol>
    ))
    .with({ kind: "list", ordered: false }, ({ items }) => (
      <ul className="list-disc pl-5">
        {items.map((item, index) => (
          <li key={index}>
            <Inlines nodes={item} />
          </li>
        ))}
      </ul>
    ))
    .with({ kind: "code" }, ({ text }) => (
      <pre className="m-0 overflow-x-auto rounded-md border border-border/60 bg-muted/40 px-2.5 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">
        {text}
      </pre>
    ))
    .exhaustive();
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the text of a Slack message as Slack will show it: bold, italic, strike, code, code blocks, lists, quotes, links and mentions. A link whose label is not its own address shows the real address in brackets after the label, and a mention shows the Slack id that Slack notifies. The text is parsed once per message, not on every render. It builds React elements from the parsed marks and never sets HTML from the text, so HTML in a message shows as typed.
 */
export function SlackMarkup({ text }: { text: string }) {
  const blocks = useMemo(() => parseSlackMarkup(text), [text]);
  return (
    <div
      data-testid="slack-markup"
      className="flex flex-col gap-1.5 break-words"
    >
      {blocks.map((block, index) => (
        <Block key={index} block={block} />
      ))}
    </div>
  );
}
