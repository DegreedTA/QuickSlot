// Pixel geometry of the recruiter calendar. This is the ONLY place the scale lives:
// change PX_PER_15 and every position, height, grid line and pointer conversion follows.
import { ROWS } from './time';

export const PX_PER_15 = 14; // 15 min = 14px, 30 min = 28px, 1 h = 56px
export const HOUR_PX = PX_PER_15 * 4;
export const PX_PER_MIN = HOUR_PX / 60;
export const COLUMN_PX = ROWS * PX_PER_15; // 15 hours (6 AM to 9 PM) = 840px

/** Top of a slot, given minutes after the first row. */
export const topOf = (minutesFromStart: number) => minutesFromStart * PX_PER_MIN;
/** Height of a slot; 1px less than its duration so grid lines and back-to-back slots stay visible. */
export const heightOf = (minutes: number) => minutes * PX_PER_MIN - 1;
/** Pointer y (px from the top of the day column) -> 15 minute row, clamped to the column. */
export const rowAtY = (y: number) => Math.min(ROWS - 1, Math.max(0, Math.floor(y / PX_PER_15)));

/** Grid lines: an hour line at the bottom of each band, a lighter half-hour line in the middle. */
export const gridBackground = [
  `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, #E4E9F0 ${HOUR_PX - 1}px, #E4E9F0 ${HOUR_PX}px)`,
  `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX / 2 - 1}px, #F4F6F9 ${HOUR_PX / 2 - 1}px, #F4F6F9 ${HOUR_PX / 2}px, transparent ${HOUR_PX / 2}px, transparent ${HOUR_PX}px)`,
].join(', ');
