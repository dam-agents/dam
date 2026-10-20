export function delegationTitle(prompt: string): string {
  return (
    prompt
      .split("\n")
      .find((line) => line.trim() !== "")
      ?.trim() ?? ""
  );
}
