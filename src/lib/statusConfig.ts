// Dashboard status thresholds. One place to change them.

/**
 * Fewer valid minutes than this in the current week (Mon-Fri) shows "Few valid times this week".
 * TODO confirm with Yasmin
 */
export const FEW_THRESHOLD_MINUTES = 120;

/**
 * On Saturday and Sunday "current week" means the coming Mon-Fri.
 * TODO confirm with Yasmin
 */
export const WEEKEND_USES_NEXT_WEEK = true;
