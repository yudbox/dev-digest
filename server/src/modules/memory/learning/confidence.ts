/**
 * autoConfidence(count) = min(0.45 + 0.06 × count, 0.9)
 *
 * Monotonic: 3 ≈ 0.63, 5 ≈ 0.75, cap 0.9.
 * AC-15/R15.
 */
export function autoConfidence(count: number): number {
  return Math.min(0.45 + 0.06 * count, 0.9);
}
