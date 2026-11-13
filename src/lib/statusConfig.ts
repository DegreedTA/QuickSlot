// Weekly minimums and dashboard thresholds. One place to change them.
// All of this is about Monday to Friday, in the candidate's (or recruiter's) time zone.

/**
 * Minimum free time the candidate must offer THIS week, Monday to Thursday. From Friday on the current
 * week is not asked for (interviews are rarely booked the same day); only next week counts.
 * Also the bar for "Few valid times this week" on the dashboard.
 */
export const MIN_MINUTES_THIS_WEEK = 4 * 60;

/**
 * Minimum for NEXT week. Required when today is Friday, Saturday or Sunday; on Monday to Thursday
 * it is only asked for politely (see NEAR_MINIMUM_EXTRA_MINUTES).
 */
export const MIN_MINUTES_NEXT_WEEK = 4 * 60;

/**
 * "Only the minimum" means: less than the minimum plus this much. A candidate who offers only the minimum
 * is asked to consider more next week (Mon-Thu: only if next week is still below its minimum).
 */
export const NEAR_MINIMUM_EXTRA_MINUTES = 60;
