#!/usr/bin/env node
import { compose } from "./modules/cli/compose.js";

const program = compose();
await program.parseAsync(process.argv);
