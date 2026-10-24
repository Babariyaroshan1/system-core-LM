export function findExistingPayrollEmployees(
  existingEmployeeIds: Iterable<string>,
  requestedEmployeeIds: Iterable<string>,
) {
  const existing = new Set(existingEmployeeIds);
  return [...new Set(requestedEmployeeIds)].filter((id) => existing.has(id));
}
