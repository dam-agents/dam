import { z } from "../../packages/api-server-api/node_modules/zod/index.js";
import { appRouter } from "../../packages/api-server-api/src/router.ts";

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
      return s.pattern ? "zap-1" : "zap";
    case "number": case "integer": return s.minimum ?? 1;
    case "boolean": return true;
    case "null": return null;
    case "array": return [sample(s.items, defs)];
    case "object": return Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, sample(v, defs)]));
    default: return s.properties ? sample({ ...s, type: "object" }, defs) : "zap";
  }
}

const out = [];
for (const [path, proc] of Object.entries<any>(appRouter._def.procedures)) {
  const type = proc._def.type;
  const inputSchema = proc._def.inputs?.[0];
  let input: any = undefined, schema: any = undefined, err: string | undefined;
  if (inputSchema) {
    try {
      schema = z.toJSONSchema(inputSchema, { io: "input", unrepresentable: "any" });
      input = sample(schema, schema.$defs ?? {});
    } catch (e: any) { err = String(e.message ?? e); }
  }
  out.push({ path, type, input, err });
}
console.log(JSON.stringify(out, null, 1));
