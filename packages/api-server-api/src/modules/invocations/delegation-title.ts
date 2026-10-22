function firstLine(text: string): string | undefined {
  return text
    .split("\n")
    .find((line) => line.trim() !== "")
    ?.trim();
}

export function delegationTitle(invocation: {
  label: string | null;
  prompt: string;
  script?: string | null;
}): string {
  const label = invocation.label?.trim();
  if (label) return label;
  return (
    firstLine(invocation.prompt) ?? firstLine(invocation.script ?? "") ?? ""
  );
}
