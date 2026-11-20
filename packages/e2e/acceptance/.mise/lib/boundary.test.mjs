import assert from "node:assert/strict";
import { test } from "node:test";

import { violations } from "./boundary.mjs";

const pkg = "/repo/packages/e2e/acceptance";
const file = `${pkg}/src/steps/agents.steps.ts`;
const check = (source) => violations(file, source, pkg);

const inside = [
  'import { test } from "../fixtures.js";',
  "import { test } from '../fixtures.js';",
  'import type { Persona } from "../people.js";',
  'import * as world from "../world.js";',
  'import "./side-effect.js";',
  'export { test } from "../fixtures.js";',
  'export * from "../world.js";',
  'export type { Persona } from "../people.js";',
  'const m = await import("../world.js");',
  'const m = require("../world.js");',
  'import m = require("../world.js");',
  'import.meta.resolve("../world.js");',
  '/// <reference path="../types.d.ts" />',
  'import {\n  a,\n  b,\n} from "../fixtures.js";',
  'import { readFileSync } from "node:fs";',
  'import { expect } from "@playwright/test";',
  'import { createBdd } from "playwright-bdd";',
  'import type { AppRouter } from "api-server-api";',
  'import { httpBatchLink } from "@trpc/client";',
  'import { x } from "@trpc/server/unstable-core-do-not-import";',
];

const leaving = [
  'import { a } from "../../../../api-server/src/modules/agents/domain/agent-access.js";',
  "import { a } from '../../../../api-server/src/x.js';",
  'import type { A } from "../../../api-server/src/x.js";',
  'import * as ui from "../../../../ui/src/brand.js";',
  'import "../../../../api-server/src/x.js";',
  'export { a } from "../../../../api-server/src/x.js";',
  'export * from "../../../playwright/src/lib/agents.js";',
  'const m = await import("../../../../api-server/src/x.js");',
  'const m = require("../../../../api-server/src/x.js");',
  'import m = require("../../../../api-server/src/x.js");',
  'import.meta.resolve("../../../../api-server/src/x.js");',
  '/// <reference path="../../../../api-server/src/x.d.ts" />',
  'import { a } from "/repo/packages/api-server/src/x.js";',
  'import {\n  a,\n} from "../../../../api-server/src/x.js";',
  'import { a } from "api-server";',
  'import { a } from "api-server/src/x.js";',
  'import { a } from "platform-ui";',
  'import { a } from "e2e-playwright/src/lib/agents.js";',
  'import { a } from "@dam-agents/cli";',
  'import { a } from "file:///repo/packages/api-server/src/x.js";',
];

const computed = [
  "const m = await import(path);",
  "const m = await import(`../${name}.js`);",
  "const m = require(name);",
];

test("every import form that stays inside the package or names an allowed dependency passes", () => {
  for (const source of inside) assert.deepEqual(check(source), [], source);
});

test("every import form that leaves the package or names another package is refused", () => {
  for (const source of leaving)
    assert.notDeepEqual(check(source), [], `passed: ${source}`);
});

test("an import whose specifier is computed is refused, since it cannot be checked", () => {
  for (const source of computed)
    assert.notDeepEqual(check(source), [], `passed: ${source}`);
});
