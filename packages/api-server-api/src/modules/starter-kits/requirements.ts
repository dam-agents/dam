export function requirementAccepts(
  requirement: { accepts: readonly string[] },
  templateId: string,
  familyId?: string,
): boolean {
  return (
    requirement.accepts.includes(templateId) ||
    (familyId !== undefined && requirement.accepts.includes(familyId))
  );
}
