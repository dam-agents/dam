import { z } from "zod";
import type { ConnectionTemplate } from "../connection-template.js";

/**
 * Custom Header credential (ADR-051). User-typed header injection on a
 * fixed host — replaces what the legacy "Generic Secret" + provider-preset
 * surfaces used to provide. Examples: an internal billing API behind
 * `X-API-Key`, a third-party SaaS behind `X-Token`.
 */
const inputsSchema = z.object({
  host: z.string().min(1),
  headerName: z.string().min(1),
  /** Format string with `{value}` placeholder. Default: just the value. */
  valueFormat: z.string().min(1).default("{value}"),
  value: z.string().min(1),
  /** Optional display name. Default: the host. */
  name: z.string().min(1).optional(),
});

type Inputs = z.infer<typeof inputsSchema>;

export function createCustomHeaderTemplate(): ConnectionTemplate<Inputs> {
  return {
    id: "custom-header",
    name: "Custom header credential",
    category: "other",
    isCustom: true,
    description:
      "Inject a header (API key, PAT, bearer) on outbound calls to a host.",
    iconSlug: "key",
    authKinds: ["header"],
    contributedKinds: ["egress-host"],
    inputs: inputsSchema,

    build({ inputs, mintSecretRef }) {
      const name = inputs.name ?? inputs.host;
      const secretPath = mintSecretRef(`connection:header:${name}`);
      const valueRef = { ...secretPath, field: "value" };
      return {
        auth: {
          kind: "header",
          valueRef,
          headerName: inputs.headerName,
          valueFormat: inputs.valueFormat,
        },
        contributions: [{ kind: "egress-host", host: inputs.host }],
        secrets: new Map([[secretPath.path, { value: inputs.value }]]),
        defaultName: name,
      };
    },

    toView() {
      return {
        id: "custom-header",
        name: "Custom header credential",
        category: "other",
        isCustom: true,
        description:
          "Inject a header (API key, PAT, bearer) on outbound calls to a host.",
        iconSlug: "key",
        authKinds: ["header"],
        contributedKinds: ["egress-host"],
      };
    },
  };
}
