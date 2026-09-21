import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";

import {
  starterKitCatalogSchema,
  starterKitSchema,
} from "../src/modules/starter-kits/schemas.js";

const OPTS = { io: "input", unrepresentable: "any" } as const;
const BASE =
  "https://raw.githubusercontent.com/dam-agents/dam-starter-kits/main";

function render(schema: object, title: string, file: string): string {
  const { $schema: _drop, ...rest } = schema as Record<string, unknown>;
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      $id: `${BASE}/${file}`,
      title,
      ...rest,
    },
    null,
    2,
  )}\n`;
}

const outDir = process.argv[2];
if (!outDir) {
  console.error("usage: gen-kit-schema.ts <out-dir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

for (const [file, schema, title] of [
  ["kit.schema.json", starterKitSchema, "Starter kit"],
  ["catalog.schema.json", starterKitCatalogSchema, "Starter kit catalog"],
] as const) {
  writeFileSync(
    path.join(outDir, file),
    render(z.toJSONSchema(schema, OPTS), title, file),
  );
}
