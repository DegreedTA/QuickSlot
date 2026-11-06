---
name: QuickSlot
description: Tide Almanac. Free time drawn as high water on a dense, number-first, light-only operating tool.
colors:
  rail-deep-teal: "#0e2f3d"
  rail-hi: "#17475a"
  rail-ink: "#e4f0f1"
  rail-dim: "#94b5bd"
  chart-ground: "#eaf2f2"
  panel-white: "#ffffff"
  rule: "#c6d9da"
  rule-soft: "#dbe8e8"
  ink: "#0e2f3d"
  ink-2: "#35545f"
  ink-3: "#4b6773"
  tide-band: "#9ed8d2"
  tide-edge: "#0b6e69"
  tide-ink: "#053f3c"
  action: "#0b6e69"
  action-hi: "#09595a"
  change-coral: "#b8341b"
  change-coral-wash: "#fbe8e2"
  danger: "#a3213f"
typography:
  h1:
    fontFamily: "Hanken Grotesk Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 620
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  h2:
    fontFamily: "Hanken Grotesk Variable, system-ui, -apple-system, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 620
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  figure:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  control:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 560
  caption:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
  band-label:
    fontFamily: "Hanken Grotesk Variable, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.1
rounded:
  control: "6px"
  panel: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.action}"
    textColor: "{colors.panel-white}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  button-primary-hover:
    backgroundColor: "{colors.action-hi}"
  button-default:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 16px"
    height: "38px"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "38px"
  tab-selected:
    backgroundColor: "{colors.rail-deep-teal}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.control}"
    height: "34px"
  tag-change:
    backgroundColor: "{colors.change-coral-wash}"
    textColor: "{colors.change-coral}"
    typography: "{typography.caption}"
    padding: "2px 8px"
  panel:
    backgroundColor: "{colors.panel-white}"
    rounded: "{rounded.panel}"
    padding: "20px"
  nav-item-current:
    backgroundColor: "{colors.rail-hi}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.control}"
    height: "38px"
---

# Design System: QuickSlot

## Overview

**Creative North Star: "The Tide Almanac"**

Free time is drawn as high water. The week is a dense tabular almanac: small type, tabular numerals, hairline rules, and a pale tide band that fills continuously across adjacent 15-minute cells instead of checkerboard boxes. A deep sea-teal rail anchors the shell; the working ground is a cool pale chart color; white panels appear only where a working area needs setting off.

The system serves an Operate-mode tool used in daylight, on a desk or a phone. It is light-only by decision. Structure comes from rules, not cards: groups are separated by hairlines and whitespace, and the count strip, summaries, and detail sections are plain figures between rules. Decoration is limited to the bands themselves.

**Key Characteristics:**
- Deep teal shell, pale chart ground, white working panels, hairline teal-grey rules.
- One action color (teal); one alarm-adjacent mark (coral) with a single meaning.
- Hanken Grotesk Variable throughout, tabular numerals on by default at the body level.
- One corner scale: 6px controls, 8px panels.
- Flat: no drop shadows anywhere.

## Colors

A cool, marine palette: one deep teal doing shell and ink duty, a pale water tint for availability, and one coral reserved for change.

### Primary
- **Action Teal** (`action`): primary buttons, links, today's column heading, focus on inputs. Hover steps to `action-hi`.
- **Tide Band** (`tide-band`) with **Tide Edge** (`tide-edge`) and **Tide Ink** (`tide-ink`): fill, outline/water-line, and label text of painted availability, and the selected-pick state.

### Secondary
- **Change Coral** (`change-coral`) on **Coral Wash** (`change-coral-wash`): reserved for "changed since you looked".

### Neutral
- **Deep Sea Teal** (`rail-deep-teal`, same value as `ink`): the rail, the candidate top bar, selected tabs, and primary text. `rail-hi` is the current-nav fill; `rail-ink` and `rail-dim` are text on the rail.
- **Chart Ground** (`chart-ground`): page background. **Panel White** (`panel-white`): panels, tables, the week grid, inputs.
- **Rule** and **Rule Soft**: hairline borders and dividers; soft for inside-table and half-hour lines.
- **Ink 2 / Ink 3**: secondary and tertiary text.
- **Danger** (`danger`): validation errors and destructive buttons only.

### Named Rules
**The Coral Means Changed Rule.** Coral appears only on a link, row, or count that changed since the recruiter last opened it. It is never decoration, never an error state, never a button.

**The One Action Rule.** Teal is the only action color. Primary buttons are the sole filled teal controls.

## Typography

**Display / Body / Label Font:** Hanken Grotesk Variable (via @fontsource-variable, with system-ui, -apple-system, Segoe UI fallback)
**Mono:** system monospace stack, used only for `code` (share URLs).

**Character:** Compact, neutral, number-first. Hierarchy comes from weight (560-650) and slight negative tracking on headings, not from large size jumps.

### Hierarchy
- **H1** (620, 1.875rem, 1.15; 1.5rem under 520px): page titles.
- **H2 / week title** (620, 1.125rem, 1.25): section and week headings.
- **Figure** (600, 1.5rem, -0.02em): count-strip numbers.
- **Body** (400, 0.9375rem, 1.5): default text and inputs.
- **Control** (560, 0.8125rem): buttons, tabs, nav, labels.
- **Caption** (600, 0.75rem): tags, hour labels, table heads, small notes.
- **Band label** (600, 0.6875rem): the range text inside a tide band.

### Named Rules
**The Numerals Align Rule.** Tabular numerals stay on for all text so times, counts, and ranges line up in columns.

## Layout

A fixed 232px rail plus a main column (max 1180px, padding clamp 20-48px) for the manager; the candidate page is a single column (max 1040px). Link detail uses a 1.55fr / 1fr two-column grid with a 56px gap, collapsing at 980px. Spacing steps observed: 4, 6, 8, 12, 16, 20, 24, 32px. The week grid is a 52px time column plus five equal day columns, with 16px 15-minute rows. At 860px the rail becomes a top row; at 760px tables become stacked entries; at 520px band labels are replaced by a text readout of free ranges above the grid.

## Elevation & Depth

Flat. There are no shadows. Depth is conveyed by tone (ground versus white panel), hairline rules, and the sticky week header. The only stacking is functional (sticky header z 10, toast z 30).

### Named Rules
**The Rules Not Cards Rule.** Separate groups with hairlines and spacing. A bordered white panel is allowed only for a working area (create form, links table, week grid), never for a repeated tile.

## Shapes

One scale: controls, tabs, chips, nav items, picks, and notices use 6px; panels, the table wrapper, and the week grid use 8px; tide bands round their outer top and bottom corners at 6px. Tags use 4px and skeletons 4px as small inner elements. Rank and number badges are circles. Borders are 1px hairlines in `rule`, with `#9fbabd`-toned strokes on inputs, chips, and picks.

## Components

### Buttons
- **Shape:** 6px corners, 38px tall (32px small), 0 16px padding, 0.8125rem / 560.
- **Primary:** Action Teal fill, white text; hover `action-hi`.
- **Default:** white with a Rule border; hover pale `#f3f8f8`. **Quiet:** transparent, wash on hover. **Danger:** danger-colored text with a rose border.
- **Active:** 1px downward nudge. **Disabled:** 55% opacity. Transitions 160ms on the shared ease.

### Inputs / Fields
- 38px, 6px corners, white fill, 1px teal-grey stroke darkening on hover. Focus: 2px action outline with 1px offset. Invalid: danger border plus a danger message line. Labels 0.8125rem / 560 above; hints in Ink 3.

### Tabs and Tags
- Tabs are transparent, 34px, and fill Deep Sea Teal with white text when selected. Tags are 4px-cornered small pills; the change tag uses Coral on Coral Wash. Quiet tags are plain text.

### Navigation
- Rail items 38px, 6px corners, `rail-ink` text; hover is a faint white wash; current page uses `rail-hi`. Focus outline is white on the rail. At narrow widths the rail becomes a horizontal bar.

### Tide Band (signature)
Selected cells render as one continuous outlined band: pale-teal fill (`tide-band`), 1px `tide-edge` sides, a heavier 2px water-line on the top edge, 6px outer corners, inset 4px from the cell sides. Each band is labeled with its range in `tide-ink`. Past or unavailable cells are hatched (135-degree thin diagonal lines). Suggested times are a dashed 1.5px ink outline with a filled ink circular rank badge. A painted band fades in as one mass over 240ms (opacity only), gated behind `prefers-reduced-motion: no-preference`. Hover on an empty cell is a faint teal wash. A legend with matching swatches explains band, suggestion, and past cells. Meaning never rests on color alone: labels, hatching, and dashes carry it.

### Link Table and Count Strip
- Table inside an 8px white wrapper, caption-size heads on a faint wash, rows divided by Rule Soft, numeric columns right-aligned. Rows with an unseen change carry a pale coral wash and the coral "New update" tag. The count strip is plain large figures separated by vertical rules between two horizontal rules; the changed count turns coral when nonzero.

## Do's and Don'ts

### Do:
- **Do** draw availability as continuous tide bands with the 2px water-line and a range label.
- **Do** keep coral exclusively for "changed since you looked".
- **Do** use only 6px for controls and 8px for panels.
- **Do** keep tabular numerals and name the time zone beside every time.
- **Do** separate groups with rules and spacing; reserve bordered panels for working areas.
- **Do** gate any new animation behind `prefers-reduced-motion` and keep it to opacity or short transforms on the shared ease (`cubic-bezier(0.16, 1, 0.3, 1)`).

### Don't:
- **Don't** add a dark theme; light only is a standing decision.
- **Don't** use coral for errors, buttons, or emphasis; errors use Danger.
- **Don't** add shadows, gradients, or decorative imagery; the bands are the only ornament.
- **Don't** render availability as separate boxed cells or equal-width cards.
- **Don't** introduce a second action color or a floating blue primary button.
