/**
 * The throwaway agent name minted for an Invocation target: `invocation-` plus
 * 12 hex chars. Mint and recognizer live together so the shape has one owner —
 * the recognizer is exported through the module boundary for read paths that
 * must never surface a target as if it were a real agent (a target is not an
 * independent principal; see ubiquitous-language.md, Spend Attribution).
 */

const TARGET_NAME = /^invocation-[0-9a-f]{12}$/;

/** Build a target name from 12 lowercase hex chars (the caller supplies the
 *  entropy). Asserts the result against the recognizer, so a mint the
 *  recognizer would miss fails at the call site instead of leaking a
 *  target name into read paths. */
export const invocationTargetName = (hex: string): string => {
  const name = `invocation-${hex}`;
  if (!TARGET_NAME.test(name)) {
    throw new Error(
      `invocation target name mint out of lockstep with recognizer: "${name}"`,
    );
  }
  return name;
};

/** True when `name` is a minted Invocation-target name. */
export const isInvocationTargetName = (name: string): boolean =>
  TARGET_NAME.test(name);
