export class NoDefaultModelError extends Error {
  readonly pending: boolean;

  constructor(opts: { pending?: boolean } = {}) {
    super(
      opts.pending
        ? "this agent is still setting up its model; try again in a minute"
        : "this agent has no model provider it can run on; connect a model provider on its Providers page",
    );
    this.name = "NoDefaultModelError";
    this.pending = opts.pending ?? false;
  }
}

export function isNoDefaultModelError(e: unknown): e is NoDefaultModelError {
  return e instanceof NoDefaultModelError;
}
