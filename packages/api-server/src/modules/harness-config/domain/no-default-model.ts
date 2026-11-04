export class NoDefaultModelError extends Error {
  readonly pending: boolean;

  constructor(
    readonly model?: string,
    opts: { pending?: boolean; profile?: boolean } = {},
  ) {
    super(
      opts.pending
        ? "this agent is still setting up its default model; try again in a minute"
        : opts.profile
          ? "the profile this agent's default names cannot run on it; pick another default on its Providers page"
          : model === undefined
            ? "this agent has no model provider that lists a model it can run; connect a model provider on its Providers page"
            : `no provider this agent holds serves ${model}; attach its provider or pick another model`,
    );
    this.name = "NoDefaultModelError";
    this.pending = opts.pending ?? false;
  }
}

export function isNoDefaultModelError(e: unknown): e is NoDefaultModelError {
  return e instanceof NoDefaultModelError;
}
