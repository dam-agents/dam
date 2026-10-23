export function readFlowIdFromSearch(search: string): string | null {
  const flow = new URLSearchParams(search).get("flow");
  return flow && flow.length > 0 ? flow : null;
}

export function readCallbackErrorFromSearch(search: string): string | null {
  return new URLSearchParams(search).get("error");
}

export interface BindErrorCopy {
  title: string;
  hint: string;
  terminal: boolean;
}
