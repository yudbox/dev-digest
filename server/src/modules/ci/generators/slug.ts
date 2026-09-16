/**
 * Slug generator — kebab-case names with collision-suffix deduplication.
 * Pure function; no DB access.
 */

/** Convert an arbitrary string to a lowercase kebab-case slug. */
export function kebabSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent"
  );
}

/**
 * Deduplicate an ordered list of names into unique kebab slugs.
 * Collisions get a `-2`, `-3`, … suffix (second occurrence onward).
 *
 * @example
 * dedupeSlugs(['My Agent', 'My Agent', 'Other']) → ['my-agent', 'my-agent-2', 'other']
 */
export function dedupeSlugs(names: string[]): string[] {
  const counts = new Map<string, number>();
  return names.map((name) => {
    const base = kebabSlug(name);
    const seen = (counts.get(base) ?? 0) + 1;
    counts.set(base, seen);
    return seen === 1 ? base : `${base}-${seen}`;
  });
}
