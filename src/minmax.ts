/**
 * Min-max normalisation onto [0, 1].
 *
 * @module
 * Park et al. normalise recency, importance and relevance to [0, 1] with
 * min-max scaling before summing them. This runtime takes the min and max
 * over the CANDIDATE SET being ranked (every memory the agent holds), not
 * over some global constant range — see DECISIONS.md § M2.
 *
 * Contract:
 * - `[]` → `[]`.
 * - All elements equal (including a single element) → every element is 1.
 * - Otherwise each element maps to (x - min) / (max - min).
 * - Order is preserved; the input array is not mutated.
 * - A non-finite element (NaN, ±Infinity) throws.
 */
import { todo } from "./todo.ts";

export const minMax = (values: number[]): number[] => todo(values);
