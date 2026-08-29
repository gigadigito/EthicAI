/**
 * Maximum number of branches allowed per scenario.
 * Prevents infinite parry/recovery loops.
 *
 * Example max path:
 *   Pass deflected → recovery → Shot parried → recovery → second shot → done
 */
export const MAX_SCENARIO_BRANCHES = 2;
