// Weekly minimums and dashboard thresholds. One place to change them.
// All of this is about Monday to Friday, in the candidate's (or recruiter's) time zone.

/**
 * Minimum free time the candidate must offer THIS week when today is Monday, Tuesday or Wednesday.
 * Also the bar for "Few valid times this week" on the dashboard.
 */
export const MIN_MINUTES_MON_WED = 4 * 60;

/**
 * Same, when today is Thursday (the week is nearly over). From Friday on the current week is not
 * asked for at all (interviews are rarely booked the same day); only next week counts.
 */
export const MIN_MINUTES_THU = 2 * 60;

/**
 * Minimum for NEXT week. Required when today is Friday, Saturday or Sunday; on Monday to Thursday
 * it is only asked for politely (see NEAR_MINIMUM_EXTRA_MINUTES).
 */
export const MIN_MINUTES_NEXT_WEEK = 4 * 60;

/**
 * Friday to Sunday: next week counts as "enough" from this much (6 h). Below it (5.5 h or less) the
 * dashboard says "Few valid times next week" and the candidate sees the polite request for more times.
 */
export const COMFORTABLE_MINUTES_NEXT_WEEK = 6 * 60;

/**
 * "Only the minimum" means: less than the minimum plus this much. A candidate who offers only the
 * minimum is gently asked for more times (Mon-Thu; see `appeal` in weeklyMinimum.ts).
 */
export const NEAR_MINIMUM_EXTRA_MINUTES = 60;
