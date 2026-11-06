/** A voided punch stays stored for audit; operational views treat it as unpunched. */
export function activeTimeRecord<T extends { voidedAt: Date | null }>(record: T | null | undefined): T | null {
  return record && !record.voidedAt ? record : null;
}
