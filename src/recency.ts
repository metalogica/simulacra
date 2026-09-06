/**
 * Recency — exponential decay over game hours since the memory was created.
 *
 * @module
 * Park et al. decay over hours since the memory was LAST RETRIEVED, factor
 * 0.995. This runtime scores from the CREATION tick instead (option C,
 * DECISIONS.md § M2) so that recency stays a pure function of the log. The
 * cost is that a memory recalled daily decays exactly like one never
 * recalled. Named, accepted, revisit at M3.
 *
 * Contract:
 * - score = decay ^ ((nowTick - createdTick) / ticksPerHour).
 * - `decay` defaults to `DEFAULT_DECAY` (0.995).
 * - Result is in (0, 1]; exactly 1 when nowTick === createdTick.
 * - nowTick < createdTick throws (a memory from the future is a caller bug).
 * - ticksPerHour <= 0 throws.
 */
import { todo } from "./todo.ts";

export const DEFAULT_DECAY = 0.995;

export interface RecencyInput {
  createdTick: number;
  nowTick: number;
  ticksPerHour: number;
  decay?: number;
}

export const recencyScore = (input: RecencyInput): number => todo(input);
