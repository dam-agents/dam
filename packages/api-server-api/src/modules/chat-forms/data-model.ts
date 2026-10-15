type Container = Record<string, unknown> | unknown[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pointerSegments(path: string): string[] {
  if (path === "" || path === "/") return [];
  return path
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

function childOf(container: unknown, key: string): unknown {
  if (Array.isArray(container)) return container[Number(key)];
  if (isRecord(container)) return container[key];
  return undefined;
}

function withChild(container: unknown, key: string, value: unknown): Container {
  if (Array.isArray(container)) {
    const next = [...container];
    next[Number(key)] = value;
    return next;
  }
  return { ...(isRecord(container) ? container : {}), [key]: value };
}

export function getAt(model: unknown, path: string): unknown {
  return pointerSegments(path).reduce<unknown>(childOf, model);
}

export function setAt(model: unknown, path: string, value: unknown): unknown {
  const segments = pointerSegments(path);
  const write = (node: unknown, depth: number): unknown => {
    if (depth === segments.length) return value;
    const key = segments[depth];
    return withChild(node, key, write(childOf(node, key), depth + 1));
  };
  return write(model, 0);
}

function withoutChild(container: unknown, key: string): unknown {
  if (Array.isArray(container)) {
    const next = [...container];
    next.splice(Number(key), 1);
    return next;
  }
  if (!isRecord(container)) return container;
  return Object.fromEntries(
    Object.entries(container).filter(([entry]) => entry !== key),
  );
}

export function deleteAt(model: unknown, path: string): unknown {
  const segments = pointerSegments(path);
  if (segments.length === 0) return {};
  const remove = (node: unknown, depth: number): unknown => {
    const key = segments[depth];
    if (depth === segments.length - 1) return withoutChild(node, key);
    const child = childOf(node, key);
    if (child === undefined) return node;
    return withChild(node, key, remove(child, depth + 1));
  };
  return remove(model, 0);
}
