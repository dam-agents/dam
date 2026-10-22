export function sessionTitleLabel(s: {
  title?: string | null;
  sessionId: string;
}): string {
  return s.title || `(no title · ${s.sessionId.slice(0, 8)})`;
}

export interface RenameDefaults {
  value: string;
  placeholder: string | undefined;
}

export function renameDefaults(s: {
  title?: string | null;
  customTitle?: string | null;
  autoTitle?: string | null;
}): RenameDefaults {
  if (s.customTitle === undefined)
    return { value: (s.title ?? "").replace(/…$/, ""), placeholder: undefined };
  return {
    value: s.customTitle ?? "",
    placeholder: s.autoTitle ?? undefined,
  };
}
