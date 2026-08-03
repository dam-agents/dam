/** Spread onto every `<a>` that leaves the app. `noreferrer` already implies
 *  `noopener` in current browsers, but both are named so the intent survives a
 *  future edit that drops one of them. */
export const externalLinkProps = {
  target: "_blank",
  rel: "noopener noreferrer",
} as const;
