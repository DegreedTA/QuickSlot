# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Confirmed with the user: React + TypeScript front end built as a static site, with Supabase (Postgres) as the backend, reached only through database functions. No application server. Hosting target for the static site is undecided (Vercel, Netlify, or Degreed's own hosting, pending IT).

## Users

- **Recruiters at Degreed** (primary, the "manager" side). They hold interview-scheduling work for many candidates at once. They create links, send them, then read what candidates shared and pick interview times that also fit the interviewer's calendar.
- **Candidates** (secondary, the "candidate" side). Arrive from a link in an email, usually once, sometimes again days later when their calendar changes. No account, no login. Often on a phone. Time zones differ from the recruiter's.

## Product Purpose

QuickSlot lets a recruiter collect a candidate's interview availability through one private link, then see it in the recruiter's own time zone. The candidate shares free windows across the next 30 days, can come back to the same link and change them, and is told plainly that they are not booking anything. Recruiters can also suggest specific times (from an interviewer's availability) for the candidate to rank. Success: a recruiter can send a link in under a minute and later read the candidate's availability without a back-and-forth email thread.

This is a rebuild. The original app was made by a former Degreed employee in Lovable, tied to an account that is now disabled, so the original code is not available. Only its behavior, observed from the public site, is being reproduced.

## Positioning

A scheduling-input tool, not a booking tool. It holds no calendar integration and books nothing. The recruiter stays in control of the actual invite; QuickSlot only removes the email ping-pong that comes before it.

## Operating Context

- Recruiters work in a browser at a desk, next to their calendar and ATS, often reading availability and copying it into an email or calendar invite. A "copy availability" summary in the recruiter's time zone is a core workflow.
- Candidates open the link from email on any device. Time zone must be explicit because candidate and recruiter are often in different zones.
- Links expire automatically after 90 days.

## Capabilities and Constraints

Observed in the original app and to be kept:
- Manager page: create one link or a batch of links; dashboard counts (active links, total generated); load an existing link by pasting its URL, to edit only that link or the whole batch it belongs to.
- Candidate page `/:token`: weekly grid, Monday to Friday, 6:00 AM to 9:00 PM in 15-minute steps; 30-day window with week navigation; time zone selector (defaults to the browser's); changes save automatically; "Last updated" stamp; clear this week; an upcoming-availability summary with a Copy action, grouped by day.
- Suggested times: the recruiter adds suggested slots (date, time, interview length, in a chosen time zone); the candidate selects and ranks their preferred ones (the original required at least 2 or 3).
- Recruiter view `/:token/recruiter`: read-only view of one link's availability in the recruiter's time zone.
- Links expire after 90 days. Dead/expired links show a clear message telling the candidate to contact their recruiter.

Decided changes:
- Manager page gets a shared team passcode (the original had no login).
- Recruiters may attach a private label (for example a candidate name or role) to a link. Labels are visible only on the manager side and never sent to the candidate page.

Constraints:
- Candidate side collects only availability and time zone, no name, email, or account.
- Backend access only through Postgres functions; tables are closed to direct access.

Undecided:
- Production hosting and who owns the Supabase project at Degreed.
- Whether to add Degreed single sign-on later.

## Brand Commitments

- Name: QuickSlot (the name of the original app). Subject to change if the user says so.
- Candidate-facing copy keeps the original promises: "You are not booking an interview, you are only sharing your availability." and "This link expires automatically after 90 days."
- Degreed-internal tool: it uses the Degreed design system (see `DESIGN.md`), without the logo image (the top bar is text).

## Evidence on Hand

- The live original at https://schedule.degreedlabs.com (manager) and an example candidate link, read for behavior only. Its code and data are not available.
- No logo, brand kit, or user research supplied. Do not invent customers, usage numbers, or testimonials.

## Product Principles

1. The candidate's job is to finish in a minute or two on a phone; nothing on their page asks for more than availability and a time zone.
2. Time zones are never implicit. Every time shown names its zone.
3. The recruiter reads availability, they do not decode it: summaries are grouped by day, sorted, and one click from being pasted into an email.
4. Reassure, do not collect: privacy and "not a booking" language stays visible to the candidate.
5. Small tool, no ceremony: creating a link takes seconds and needs no setup.

## Accessibility & Inclusion

Candidates are a public audience on unknown devices and assistive tech. The availability grid must be fully keyboard and touch operable, with non-color cues for selected state, and meet WCAG AA contrast.
