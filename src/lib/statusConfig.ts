// Weekly minimums and dashboard thresholds. One place to change them.
// All of this is about Monday to Friday, in the candidate's (or recruiter's) time zone.

/**
 * Minimum free time the candidate must offer THIS week when today is Monday, Tuesday or Wednesday.
 * Also the bar for "Few valid times this week" on the dashboard.
 * TODO confirm with Yasmin
 */
export const MIN_MINUTES_MON_WED = 4 * 60;

/**
 * Same, when today is Thursday or Friday (the week is nearly over).
 * TODO confirm with Yasmin
 */
export const MIN_MINUTES_THU_FRI = 2 * 60;

/**
 * Minimum for NEXT week. Required when today is Friday, Saturday or Sunday; on Monday to Thursday
 * it is only asked for politely (see NEAR_MINIMUM_EXTRA_MINUTES).
 * TODO confirm with Yasmin
 */
export const MIN_MINUTES_NEXT_WEEK = 4 * 60;

/**
 * "Only the minimum" means: less than the minimum plus this much. A candidate who offers only the
 * minimum this week and less than MIN_MINUTES_NEXT_WEEK next week is asked to consider more next week.
 * TODO confirm with Yasmin
 */
export const NEAR_MINIMUM_EXTRA_MINUTES = 60;
