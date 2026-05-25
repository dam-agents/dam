#!/usr/bin/env node
import { compose } from "./compose.js";
import { TermsStaleAtTransportError } from "./modules/shared/trpc/trpc-client.js";

const program = compose();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  if (err instanceof TermsStaleAtTransportError) {
    process.stderr.write(
      `error: Terms of Use acceptance required\nhint: open ${err.host} to accept\n`,
    );
    process.exit(1);
  }
  throw err;
}
