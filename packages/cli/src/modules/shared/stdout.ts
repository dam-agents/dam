export async function writeStdoutAndExit(
  data: string,
  exitCode: number,
): Promise<never> {
  await new Promise<void>((resolve) => {
    process.stdout.write(data, () => resolve());
  });
  process.exit(exitCode);
}
