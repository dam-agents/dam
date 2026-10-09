interface Props {
  label: string;
  caption: string;
  captionTestId?: string;
}

export function MenuItemText({ label, caption, captionTestId }: Props) {
  return (
    <span className="flex min-w-0 flex-col">
      <span>{label}</span>
      <span
        data-testid={captionTestId}
        className="text-[11px] text-muted-foreground"
      >
        {caption}
      </span>
    </span>
  );
}
