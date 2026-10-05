export interface ApprovalToastChanges {
  raise: string[];
  clear: string[];
}

export function approvalToastChanges(
  previous: ReadonlySet<string>,
  current: ReadonlySet<string>,
): ApprovalToastChanges {
  return {
    raise: [...current].filter((id) => !previous.has(id)),
    clear: [...previous].filter((id) => !current.has(id)),
  };
}
