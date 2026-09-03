const MAX_TRACKED = 2048;

export interface UpdateDedupe {
  /** Records and returns true if updateId is new; returns false if already seen. */
  claim(updateId: number): boolean;
}

export function createUpdateDedupe(maxTracked: number = MAX_TRACKED): UpdateDedupe {
  const seen = new Set<number>();

  return {
    claim(updateId: number): boolean {
      if (seen.has(updateId)) return false;
      seen.add(updateId);
      if (seen.size > maxTracked) {
        const oldest = seen.values().next();
        if (!oldest.done) seen.delete(oldest.value);
      }
      return true;
    },
  };
}
