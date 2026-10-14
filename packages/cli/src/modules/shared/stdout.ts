export async function writeStdoutAndExit(
  data: string | Uint8Array,
  exitCode: number,
): Promise<never> {
  await new Promise<void>((resolve, reject) => {
    process.stdout.once("error", (e: NodeJS.ErrnoException) =>
      e.code === "EPIPE" ? resolve() : reject(e),
    );
    process.stdout.write(data, () => resolve());
  });
  process.exit(exitCode);
}
