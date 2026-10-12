import { Fragment, type ReactNode } from "react";

const LIST_FORMAT = new Intl.ListFormat("en", { type: "conjunction" });

export function InlineList({ items }: { items: readonly ReactNode[] }) {
  return (
    <>
      {LIST_FORMAT.formatToParts(items.map((_, i) => String(i))).map(
        (part, index) => (
          <Fragment key={index}>
            {part.type === "element" ? items[Number(part.value)] : part.value}
          </Fragment>
        ),
      )}
    </>
  );
}

export function BoldList({
  items,
  limit = Infinity,
}: {
  items: readonly string[];
  limit?: number;
}) {
  const shown = items.length > limit ? items.slice(0, limit - 1) : items;
  const rest = items.length - shown.length;
  return (
    <InlineList
      items={[
        ...shown.map((item) => (
          <strong className="font-semibold text-foreground">{item}</strong>
        )),
        ...(rest > 0 ? [`${rest} more`] : []),
      ]}
    />
  );
}
