/** UNIT_BOUNDARY_DESCRIPTION: Only the named ChatGPT login action on a Codex lease with its native provider may start device authorization. Client input never becomes executable text or arguments. */
export function nativeLoginCommand(input: {
  action: string;
  harness: string;
  chatgptGranted: boolean;
}): [string, string[]] | null {
  if (
    input.action !== "chatgpt-login" ||
    input.harness !== "codex" ||
    !input.chatgptGranted
  )
    return null;
  return ["/usr/local/bin/codex-chatgpt", ["login", "--device-auth"]];
}
