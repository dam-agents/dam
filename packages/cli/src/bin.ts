#!/usr/bin/env node
import { compose } from "./compose.js";

const program = compose();
await program.parseAsync(process.argv);
