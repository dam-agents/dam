export function delegationTitle(invocation: {
  label: string | null;
  prompt: string;
}): string {
  const label = invocation.label?.trim();
  if (label) return label;
  return (
    invocation.prompt
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}
