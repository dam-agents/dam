export type JsonSchema = Record<string, unknown>;

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
      if (looksLikeJsonSchema(obj)) return obj;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(obj)) {
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
