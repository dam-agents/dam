export function protoNavigate(path: string) {
  if (import.meta.env.VITE_PROTOTYPE) {
    window.location.hash = path;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    window.location.href = path;
  }
}

export function protoPathname(): string {
  if (import.meta.env.VITE_PROTOTYPE && window.location.hash.startsWith("#/")) {
    return window.location.hash.slice(1);
  }
  return window.location.pathname;
}
