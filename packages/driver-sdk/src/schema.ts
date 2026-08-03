// Schema sugar. The server validates an Invocation's result against a JSON
// Schema (ajv, structural only — never truth). Writing raw JSON Schema in every
// spawn buries the intent, so `s()` expands a tiny shorthand into real JSON
// Schema. Anything that already looks like JSON Schema passes through untouched,
// so you can always drop down to the full spec when the shorthand isn't enough.
//
//   s("integer")                          -> { type: "integer" }
//   s({ pass: "boolean", note: "string" })-> object, both required, no extras
//   s({ score: "number?" })               -> object, `score` optional
//   s(["string"])                         -> array of strings
//   s({ verdict: s.enum(["passed","continue"]) })  -> enum field
//   s({ verdict: { enum: ["a","b"] } })   -> same (raw JSON Schema passthrough)

/** A JSON Schema object (loosely typed — the server is the structural authority). */
export type JsonSchema = Record<string, unknown>;

/** The shorthand `s()` accepts: a primitive name (optionally suffixed "?" inside
 *  an object's field), an array `[spec]`, an object of field specs, or a raw
 *  JSON Schema object that is passed through as-is. */
export type SchemaSpec =
  | string
  | readonly SchemaSpec[]
  | { readonly [key: string]: SchemaSpec }
  | JsonSchema;

const PRIMITIVES = new Set(["string", "number", "integer", "boolean", "null"]);

function looksLikeJsonSchema(o: Record<string, unknown>): boolean {
  return (
    "type" in o ||
    "properties" in o ||
    "items" in o ||
    "enum" in o ||
    "const" in o ||
    "$ref" in o ||
    "anyOf" in o ||
    "oneOf" in o ||
    "allOf" in o
  );
}

export interface SchemaSugar {
  (spec: SchemaSpec): JsonSchema;
  /** An enum field: `s.enum(["a", "b"])` -> `{ enum: ["a", "b"] }`. */
  enum: (values: readonly unknown[]) => JsonSchema;
}

export const s: SchemaSugar = Object.assign(
  (spec: SchemaSpec): JsonSchema => {
    if (typeof spec === "string") {
      if (!PRIMITIVES.has(spec)) {
        throw new Error(
          `invocation schema: unknown shorthand type "${spec}" — use one of ${[...PRIMITIVES].join(", ")}, or pass a raw JSON Schema object.`,
        );
      }
      return { type: spec };
    }
    if (Array.isArray(spec)) {
      return { type: "array", items: spec.length ? s(spec[0]) : {} };
    }
    if (spec && typeof spec === "object") {
      const obj = spec as Record<string, SchemaSpec>;
      if (looksLikeJsonSchema(obj)) return obj; // already JSON Schema — leave it
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(obj)) {
        // A trailing "?" on a shorthand type marks the field optional.
        if (typeof val === "string" && val.endsWith("?")) {
          properties[key] = s(val.slice(0, -1));
        } else {
          properties[key] = s(val);
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      };
    }
    throw new Error(
      `invocation schema: cannot interpret ${JSON.stringify(spec)}`,
    );
  },
  {
    enum: (values: readonly unknown[]): JsonSchema => ({ enum: values }),
  },
);
