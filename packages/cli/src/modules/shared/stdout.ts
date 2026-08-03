/** Write `data` to stdout, then exit once it has drained — calling
 *  `process.exit()` straight after a large write truncates piped output at the
 *  OS pipe buffer, so we wait for the write callback first. Returns
 *  `Promise<never>`; `return` it from a command (`return writeStdoutAndExit(…)`)
 *  so the exit terminates the handler with no trailing `return`. */
export async function writeStdoutAndExit(
  data: string,
  exitCode: number,
): Promise<never> {
  await new Promise<void>((resolve) => {
    process.stdout.write(data, () => resolve());
  });
  process.exit(exitCode);
}
