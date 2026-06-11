/** Write to stdout and exit only once the stream drains — calling
 *  process.exit() right after a large write truncates piped output at the
 *  64KiB pipe buffer. Callers must return immediately after calling this. */
export function writeStdoutAndExit(data: string, exitCode: number): void {
  process.stdout.write(data, () => process.exit(exitCode));
}
