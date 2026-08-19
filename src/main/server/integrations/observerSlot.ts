export const normalizeObserverSlot = (rawSlot: unknown): number => {
  if (typeof rawSlot !== 'number' || !Number.isInteger(rawSlot) || rawSlot < 0 || rawSlot > 9) {
    return -1
  }
  return rawSlot === 9 ? 0 : rawSlot + 1
}
