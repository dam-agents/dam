const TARGET_NAME = /^invocation-[0-9a-f]{12}$/;

export const invocationTargetName = (hex: string): string => {
  const name = `invocation-${hex}`;
  if (!TARGET_NAME.test(name)) {
    throw new Error(
      `invocation target name mint out of lockstep with recognizer: "${name}"`,
    );
  }
  return name;
};

export const isInvocationTargetName = (name: string): boolean =>
  TARGET_NAME.test(name);
