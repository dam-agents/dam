export async function writeStdoutAndExit(
  data: string | Uint8Array,
  exitCode: number,
): Promise<never> {
  process.stdout.once("error", () => {});
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(data, (e?: NodeJS.ErrnoException | null) =>
      e && e.code !== "EPIPE" ? reject(e) : resolve(),
    );
  });
  process.exit(exitCode);
}
