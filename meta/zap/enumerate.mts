import { createRequire } from "node:module";
import { appRouter } from "../../packages/api-server-api/src/router.ts";

const { z } = createRequire(
  new URL("../../packages/api-server-api/src/", import.meta.url),
)("zod") as typeof import("zod");

const PATTERN_SAMPLES: Record<string, string> = {
  "^[a-z0-9]+(-[a-z0-9]+)*$": "zap-1",
  "^[A-Z_][A-Z0-9_]*$": "ZAP",
  "^[A-Za-z_][A-Za-z0-9_]*$": "ZAP",
  "^(?!\\.)[A-Za-z0-9._-]+$": "zap",
  "^\\/(?!\\/)": "/zap",
  "^\\d+(Mi|Gi)$": "512Mi",
  "^\\d+(\\.\\d+)?m?$": "500m",
  "^[a-f0-9]{64}$": "0".repeat(64),
  "^[0-9a-f]{64}$": "0".repeat(64),
  "^([01]\\d|2[0-3]):[0-5]\\d$": "09:30",
  "^\\d{4}-\\d{2}-\\d{2}$": "2026-01-01",
};

function sample(s: any, defs: any): any {
  if (!s || typeof s !== "object") return "zap";
  if (s.$ref) return sample(defs[s.$ref.replace("#/$defs/", "")], defs);
  if (s.const !== undefined) return s.const;
  if (s.enum) return s.enum[0];
  if (s.anyOf) return sample(s.anyOf[0], defs);
  if (s.oneOf) return sample(s.oneOf[0], defs);
  if (s.allOf) return Object.assign({}, ...s.allOf.map((x: any) => sample(x, defs)));
  if (s.prefixItems) return s.prefixItems.map((x: any) => sample(x, defs));
  const t = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (t) {
    case "string":
      if (s.format === "uuid") return "00000000-0000-4000-8000-000000000000";
      if (s.format === "date-time") return "2026-01-01T00:00:00.000Z";
      if (s.format === "uri" || s.format === "url") return "https://example.com/zap";
      if (s.format === "email") return "zap@example.com";
      if (s.pattern) {
        const v = PATTERN_SAMPLES[s.pattern];
        if (v === undefined) throw new Error(`no sample for pattern ${s.pattern}`);
        return v;
      }
      return "zap";
    case "number": case "integer": return s.minimum ?? 1;
    case "boolean": return true;
    case "null": return null;
    case "array": return [sample(s.items, defs)];
    case "object": return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sample(v, defs)]));
    default: return s.properties ? sample({ ...s, type: "object" }, defs) : "zap";
  }
}

const out = [];
const failures: string[] = [];
for (const [path, proc] of Object.entries<any>(appRouter._def.procedures)) {
  const inputSchema = proc._def.inputs?.[0];
  let input: unknown = undefined;
  if (inputSchema) {
    try {
      const schema = z.toJSONSchema(inputSchema, { io: "input", unrepresentable: "any" });
      input = sample(schema, schema.$defs ?? {});
    } catch (e) {
      failures.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  out.push({ path, type: proc._def.type, input });
}
if (failures.length > 0) {
  console.error(`could not sample ${failures.length} procedure(s):\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
if (out.length === 0) {
  console.error("appRouter exposed no procedures; refusing to emit an empty seed list");
  process.exit(1);
}
console.log(JSON.stringify(out, null, 1));
