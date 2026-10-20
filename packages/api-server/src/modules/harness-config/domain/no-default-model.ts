export class NoDefaultModelError extends Error {
  readonly pending: boolean;

  constructor(model?: string, opts: { pending?: boolean } = {}) {
    super(
      opts.pending
        ? "this agent is still setting up its default model; try again in a minute"
        : model === undefined
          ? "this agent has no default model; set one on its Providers page"
          : `no provider this agent holds serves ${model}; attach its provider or pick another model`,
    );
    this.name = "NoDefaultModelError";
    this.pending = opts.pending ?? false;
  }
}

export function isNoDefaultModelError(e: unknown): e is NoDefaultModelError {
  return e instanceof NoDefaultModelError;
}
