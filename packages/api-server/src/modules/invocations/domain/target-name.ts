const TARGET_NAME = /^invocation-(?:[a-z0-9]+(?:-[a-z0-9]+)*-)?[0-9a-f]{12}$/;

const MAX_LABEL_SLUG_CHARS = 30;

const labelSlug = (label: string): string =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_LABEL_SLUG_CHARS)
    .replace(/^-+|-+$/g, "");

export const invocationTargetName = (hex: string, label?: string): string => {
  const slug = label === undefined ? "" : labelSlug(label);
  const name = slug === "" ? `invocation-${hex}` : `invocation-${slug}-${hex}`;
  if (!TARGET_NAME.test(name)) {
    throw new Error(
      `invocation target name mint out of lockstep with recognizer: "${name}"`,
    );
  }
  return name;
};

export const isInvocationTargetName = (name: string): boolean =>
  TARGET_NAME.test(name);
