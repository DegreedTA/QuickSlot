---
name: QuickSlot
description: The Degreed design system applied to a light-only operating tool. True Blue actions, pill buttons, Inter, calm white cards on a Cloud page, free time drawn as sky-blue blocks and picks as fry-sauce blocks.
colors:
  true-blue: "#0062E3"
  true-blue-600: "#004FB8"
  true-blue-050: "#E6F0FD"
  moonshot: "#0F1F2C"
  fry-sauce: "#FF7F64"
  gold-medal: "#FED141"
  deep-blue: "#0026EE"
  sky: "#8FCEEE"
  white: "#FFFFFF"
  cloud: "#F4F6F9"
  mist: "#E4E9F0"
  slate: "#5A6B7B"
  text-strong: "#0F1F2C"
  text-body: "#2A3742"
  text-muted: "#5A6B7B"
  text-link: "#0062E3"
  focus-ring: "#0026EE"
  danger: "#C7472B"
  qs-avail-bg: "#C1E4F6"
  qs-avail-edge: "rgba(0,98,227,0.8)"
  qs-pick-bg: "#FFD6CD"
  qs-pick-edge: "rgba(255,127,100,0.9)"
  qs-off-bg: "#EEF1F5"
  qs-off-line: "#E2E7EE"
typography:
  page-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "32px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  candidate-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "40px"
    fontWeight: 800
    lineHeight: 1.15
    letterSpacing: "-0.02em"
  card-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  table:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
  small:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  caption:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
rounded:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  pill: "999px"
spacing:
  1: "4px"
  2: "8px"
  3: "12px"
  4: "16px"
  5: "20px"
  6: "24px"
  8: "32px"
  10: "40px"
  12: "48px"
  20: "80px"
components:
  button-primary:
    backgroundColor: "{colors.true-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    typography: "{typography.small}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.true-blue}"
    rounded: "{rounded.pill}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.true-blue}"
    rounded: "{rounded.pill}"
  text-input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.md}"
    height: "48px"
  select-pill:
    backgroundColor: "{colors.white}"
    textColor: "{colors.text-strong}"
    rounded: "{rounded.pill}"
    height: "44px"
  card:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.md}"
  status-chip-new:
    backgroundColor: "{colors.true-blue}"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    height: "26px"
---

# Design System: QuickSlot

## Overview

QuickSlot uses the **Degreed design system** (tokens from `tokens.json`, copied into `src/styles/tokens.css`). It is a light-only operating tool: a Cloud page (`#F4F6F9`), white cards with a 16px radius and a soft shadow, pill buttons in True Blue, Inter throughout, and a 72px white top bar. There is no sidebar.

Free time is drawn as **sky-blue blocks** and the times a candidate picked as **fry-sauce (orange) blocks**. Those two marks are the only decoration; everything else is white, Cloud, Mist and Moonshot text.

**Key Characteristics:**
- One action color: True Blue. Buttons are pills (fully rounded).
- Inter 400 to 800, self-hosted, `font-display: swap`. Tabular numerals and antialiasing stay on at the body level.
- Cards are `16px` radius, `1px` Mist border, `shadow-sm`. Fields are `16px`; pills (buttons, select, chips, stepper) are `999px`.
- Tokens are CSS custom properties in `src/styles/tokens.css`. Do not hard-code a color that has a token.

## Colors

### Brand
True Blue `#0062E3` (hover/pressed `#004FB8`, wash `#E6F0FD`), Moonshot `#0F1F2C`, Fry Sauce `#FF7F64`, Gold Medal `#FED141`, Deep Blue `#0026EE` (focus), Sky `#8FCEEE`, White, Cloud `#F4F6F9`, Mist `#E4E9F0`, Slate `#5A6B7B`.

### Semantic
Text: strong `#0F1F2C`, body `#2A3742`, muted `#5A6B7B`, link `#0062E3`. Surfaces: page white, card white, sunken Cloud. Border: Mist. Focus: Deep Blue.

### Calendar marks (precomputed hex, never `color-mix`)
- **Availability:** bg `#C1E4F6` (Sky 55% on white), 3px inset left edge `rgba(0,98,227,0.8)`.
- **Selected (candidate pick):** bg `#FFD6CD` (Fry Sauce 32% on white), 3px inset left edge `rgba(255,127,100,0.9)`, a Moonshot rank badge (21px circle, white 12px/700).
- **Suggested, not picked:** Cloud with 135-degree Slate hatching at 50% opacity.
- **Unavailable day:** 135-degree hatching in `--qs-off-bg` `#EEF1F5` with `--qs-off-line` `#E2E7EE` lines, 9px and 10px. Deliberately unlike "suggested": that one is Slate at 50% with 5px lines, and the two must never be read as the same thing.

### Status chips
Exactly one per link. Shown as pills that are only as wide as their words, 26px tall, 13px/700, text left-aligned.

| Status | Look |
| --- | --- |
| New update | True Blue fill, white text |
| Waiting for picks, Waiting for availability | Mist fill, Slate text |
| Up to date | White with a Mist border, Moonshot text |
| Few valid times this week | Gold at 28%, text `#7A5A00` |
| No valid times this week | Fry Sauce at 16%, text `#C7472B` |
| Few valid times next week | Same as "Few valid times this week" (shown Fri-Sun) |
| No valid times next week | Same as "No valid times this week" (shown Fri-Sun) |

### Named Rules
**The Today Is Blue Rule.** In every calendar and day-column header, today's weekday and date are True Blue.

**The Picks Stay Orange Rule.** A time the candidate picked is part of their availability, but it keeps the orange "selected" look. It never turns into a blue availability block, and the recruiter cannot clear it.

**The Grey Beats Blue Rule.** A day the candidate marked unavailable is Slate-muted in the day header even when it is today, so "off" wins over "The Today Is Blue Rule".

**The Danger Rule.** `#C7472B` is for errors, the destructive button, and the "No valid times" chip only.

## Typography

Inter, with system fallbacks. Scale tokens: h1 40, h2 32, title 20, body-lg 18, body 16, table 15, body-sm 14, caption 13, label 12.

- **Page title** (800, 32px, 1.15, -0.01em): recruiter pages. **Candidate title** (800, 40px, -0.02em).
- **Card title** (800, 20px, -0.01em). **Body** 16px; **table text** 15px; **table headers** 16px/600 Slate (never smaller than the body text under them).
- **Small** 14px/600 for labels and links; **caption** 13px for chips and hour labels.

## Layout

- **Top bar:** 72px, white, 1px Mist bottom border, 48px side padding. Recruiter: "QuickSlot" 20px/800 on the left (a "Demo mode" badge beside it when active), "Sign out" ghost button on the right. Candidate: "Degreed" 18px/800 + " · QuickSlot" 18px/400 Slate.
- **Dashboard:** main max 1240px, padding 48/48/80, gap 32. Create card (grid `1fr 160px 200px`), a filter row on the same grid, then the links table in a card (min width 860, scrolls horizontally).
- **Link detail:** main max 1360px, padding 32/48/80. Two columns, gap 40: calendar column (`flex 999 1 640px`) and a side column (`flex 1 1 380px`, max 440). Blocks in the calendar column are 32px apart, with 12px extra around the legend.
- **Candidate:** main max 1200px, padding 48/24/80, gap 32: intro, three section cards, a save bar, a footer line.
- **Narrow screens** keep working (single column, 40px hour column, taller rows on touch) but are not redesigned.

## Elevation & Depth

Cards use `shadow-sm`; the primary button uses `shadow-blue`; menus use `shadow-lg`; the candidate save bar uses `shadow-md`. Tooltips use `shadow-md`.

## Components

Shared primitives live in `src/components/ui` (CSS in `src/styles/primitives.css`). Pages reuse them; do not restyle a page's own copy.

- **Button** (`sm` 14px, `md` 15px, `lg` 17px; `primary`, `secondary`, `ghost`): pill, Inter 700, 1.5px border. Hover `brightness(0.94)`, active `scale(0.97)`. Keyboard focus: 3px Deep Blue outline, 2px offset.
- **IconButton** 36x36, no background at rest, with an `aria-label` and a **Tooltip**. **Tooltip:** Moonshot, white 13px/600, appears above after 300ms on hover or keyboard focus. Inside the links table it aligns to the button's left edge so the table never clips it. Copy buttons switch to "Copied" for 1.5s.
- **TextInput** 48px, 16px radius, 1.5px Mist border, 15px text, label above (13px/600).
- **Select (pill)** 44px (48px on the candidate page). The time zone box is a combobox drawn like it.
- **Focus on text fields:** one line only, the field's own border turns True Blue. No outer outline, no halo, same radius as the field.
- **Card**, **Badge**, **Stepper** (136x48 pill with − and +), **NavArrow** (44px circle), **StatusChip**.
- **Week tabs** (recruiter): 140x52, 10px radius, selected True Blue with the free hours underneath.
- **More menu:** a 46px outlined circle (True Blue border, True Blue 050 fill) opening a 220px menu: Rename link, Deactivate link.
- **Suggested-time option** (candidate): 48px, 10px radius; not picked is a Mist outline with an empty ring, picked is the orange block with the Moonshot rank circle.
- **Week notice** (candidate): True Blue 050 bar when hours are still required, gold bar for the polite "consider next week" appeal.
- **Save bar:** check icon, "Saved 8:26 PM · 6 picks · 7.25 h free", and the `lg` "I'm done →" button.

### Calendar (shared by recruiter and candidate)
One component, `WeekCalendar`. Mon to Fri, a 64px hour column, 12px right and bottom padding, day columns with a 1px Mist left border (the last one also a right border), hour lines Mist and half-hour lines Cloud.

- **Day header:** two lines, centred, 14px top padding. The weekday is 11px/600 uppercase with `.09em` tracking; the day number alone sits under it at 26px/400 in a 46px line box. Today is True Blue in both lines at 600 weight, with **no circle and no fill**. An unavailable day is `--text-muted` in both lines, and that wins over today's blue. The full date ("Monday, November 16") is there for screen readers. Mobile: 10px weekday, 20px number in a 36px box.
- **Unavailable days** (candidate only): a row of checkboxes under the day header, on the sunken background, carrying the header's bottom border. One per day, labelled "Unavailable", plus an unlabelled one over the hour column that marks the whole week (`aria-label` "Mark the whole week unavailable") and goes to a dash when only some days are on. The box is 16x16, 4px radius, a 1.5px Slate border, filled Slate with a white Phosphor check when on; **never blue** (blue means "free") and never a pill or a card around the label. Keyboard focus is a 3px Deep Blue ring on the box. On mobile the word "Unavailable" is left to screen readers and only the box shows.
- **An unavailable day** is drawn as a hatched overlay over the whole column, under the slots so the recruiter's suggestions stay on top and clickable, with a white pill badge ("Unavailable" plus a Phosphor `Prohibit` icon) 22px down. The badge appears only when the band is at least one hour tall, and drops to the icon alone on mobile. It fades in over 220ms. Because the dates belong to the candidate's zone, a recruiter in another zone can see the band cover part of one column or parts of two: that is correct, not a bug. **The badge is the one piece of text allowed over a calendar column** — it is an overlay, not a slot, so the "no text inside calendar slots" rule still holds for slots.
- **Scale:** `src/lib/calendarGeometry.ts` is the only place it lives. 15 min = 14px (1 h = 56px, the 6 AM to 9 PM range is 840px); touch screens use 24px rows. Slot top = minutes x 56/60; slot height = minutes x 56/60 - 1, so grid lines and back-to-back slots stay visible. Slots are inset 1px with a 6px radius and contain no text except the rank badge.
- **Availability** is drawn as continuous blocks; suggestions are always separate blocks.
- **Recruiter:** drag to suggest (a dashed True Blue preview), hover or focus a slot for its exact time, click a suggestion that nobody picked to remove it.
- **Candidate:** click or drag to mark or unmark 15-minute rows, arrow keys plus Space (Shift to extend) from the keyboard, a "Draw" toggle on touch screens. Rows before the 3-hour notice or past the 30-day window are shaded.

### Motion
Short and functional. Buttons nudge on press. When the time zone changes, the calendar and suggested times blink once (about 480ms, opacity only) so people see the times were recalculated. With `prefers-reduced-motion` the blink becomes a gentle 200ms fade.

## Do's and Don'ts

### Do:
- **Do** use the tokens and the shared primitives; add a token before adding a new color.
- **Do** keep orange for "selected by the candidate" and blue for availability.
- **Do** keep table header text at least as large as body text.
- **Do** name the time zone beside every time and keep tabular numerals.
- **Do** give every icon-only button an `aria-label` and a tooltip.

### Don't:
- **Don't** add a dark theme or a sidebar.
- **Don't** add a second action color or restyle a button locally.
- **Don't** put text inside calendar slots or merge back-to-back suggestions. (The "Unavailable" badge is an overlay over the column, not a slot.)
- **Don't** give text fields an outer outline on focus.
- **Don't** use `color-mix` for the calendar marks; use the precomputed hex tokens.
