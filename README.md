# QuickSlot

A rebuild of the interview-availability tool that was originally made in Lovable. A recruiter creates a private link, sends it to a candidate, and the candidate marks when they are free. The recruiter reads it in their own time zone.

- **Recruiter side** (`/`): sign in with a shared team passcode, create links (one or a batch of up to 25), give each a private label, see which links changed since you last looked, suggest specific interview times, copy a day-by-day summary for email.
- **Candidate side** (`/<code>`): no login. Marks free time over the next 30 days (Monday to Friday only), types a city or time zone, ranks any times the recruiter suggested. Saves automatically. Can come back to the same link. Anything less than 3 hours from now is greyed out.
- **Recruiter link view** (`/<code>/recruiter`): the same candidate, read-only, in the recruiter's time zone.

Links expire after 90 days, or sooner if a recruiter deactivates them. The candidate side stores only availability and time zone.

## Try it right now (no setup)

You need [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dev
```

Open the address it prints. With no database configured it runs in **demo mode**: the passcode is `demo-passcode` and everything is stored in your own browser only. Nothing is shared with anyone.

## Put it live

This takes about 20 minutes. Steps 1 to 3 need whoever owns Degreed's cloud accounts, so ask IT to own the Supabase project (so this does not depend on one person's account again).

### 1. Create the database (Supabase)

1. Create a free project at [supabase.com](https://supabase.com), under a Degreed-owned account.
2. Open **SQL Editor**, paste the entire contents of `supabase/schema.sql`, and run it.
3. In the same editor, set the recruiter passcode (at least 10 characters, share it only with your team):

   ```sql
   select public.set_manager_passcode('choose-a-long-team-passcode');
   ```

   Run that same line again any time you want to change the passcode.
4. Open **Project Settings > API** and copy two values: the **Project URL** and the **anon public** key. The anon key is meant to be public. It cannot read the tables; it can only call the functions in `schema.sql`.

### 2. Publish the website

The site is static files. Any of these work:

- **Vercel or Netlify (easiest):** connect the repository, set the build command to `npm run build` and the output folder to `dist`. Add two environment variables: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with the values from step 1. Redirect rules for single-page routing are already included (`vercel.json`, `public/_redirects`).
- **Degreed's own hosting:** run `npm run build` with those two variables set, then upload the `dist` folder. Make sure every unknown path serves `index.html`.

### 3. Point the address at it

Ask IT to point `schedule.degreedlabs.com` at the new site. The old links (`/<12 characters>`) will not work, because the old data lives in the old backend. Create fresh links in the new tool.

### 4. Check it works

1. Open the site, sign in with your passcode, create a link labelled `Test`.
2. Open that link in a private window, mark some times. You should see "Saved".
3. Back on the recruiter page, the link shows a coral **New update** mark. Open it and you should see the times.
4. Suggest a time, rank it as the candidate, and confirm it shows up.
5. Deactivate the test link and confirm the candidate page says it is no longer active.

## Suggested times

- Recruiters drag on the calendar in 15 minute steps, then choose the interview length. The interviews are laid back to back from the start of the range: 9:00 to 10:00 with 30 minutes gives two options (9:00 and 9:30), and 10:00 to 10:45 gives one (10:00). The candidate sees the suggestions grouped by day and ranks the ones they prefer; only the ones they rank are drawn on their calendar.
- **Clear all** removes every suggested time on the link (or the whole batch).
- Suggested times that have already started are deleted automatically. The database does this whenever a link or the dashboard is opened, and every 15 minutes on its own if the `pg_cron` extension is on (Supabase: Database > Extensions > pg_cron). `schema.sql` tries to turn it on and schedule the job; if it cannot, nothing breaks.
- If the database was set up before this change, run the whole of `supabase/schema.sql` again in the SQL Editor. It is safe to re-run.

## Time zones

- Everyone sees times in their own zone. The recruiter's default is their device's zone, and any recruiter view or suggestion can use another zone (for example the interviewer's).
- The zone list comes from the browser and is refreshed once a day from a free time zone API (worldtimeapi.org, then timeapi.io). If both are unreachable the app keeps working from the browser's own list. Offsets and daylight saving always come from the browser.
- Weekends are never shown or accepted.

## How it is protected

- The tables are closed to the public. The website can only call named functions.
- Candidates need the secret 16-character code. Codes are random and not guessable.
- Recruiter functions need the passcode on every call. After 20 wrong attempts in 10 minutes, all recruiter sign-ins are locked for 10 minutes (this is shared, so a stranger guessing can lock your team out briefly).
- Candidates never receive the private label.
- The passcode is kept in the browser tab only and disappears when the tab closes.

Things to know:

- It is one shared passcode. There is no record of which recruiter did what. If you later want individual sign-in, the next step is Degreed single sign-on, which needs IT.
- Anyone who has a candidate's link can edit that candidate's availability. That is by design (it is how the candidate returns to it).
- Every recruiter can see every link and label.

## What changed from the old app

| Old | New |
| --- | --- |
| Manager page open to anyone with the address | Shared passcode |
| Links identified only by a code | Optional private label |
| 12-character codes | 16-character codes |
| No marker for changes | "New update" mark until a recruiter opens the link |
| Plain time zone dropdown | Type a city or zone ("nyc", "brasil", "pst", "gmt-3"); recruiters can suggest times in any zone and candidates see them converted |
| Slots could be picked at any time | Nothing sooner than 3 hours from now can be picked (set in `src/lib/time.ts`). Availability and suggested times snap to 15 minutes |
| Plain white form look | New look: the Degreed design system (True Blue pills, Inter, white cards), sky-blue availability and orange picks, tabular numbers. See `DESIGN.md` |
| Any amount of availability accepted | Weekly minimums for candidates: 4 h this week Mon-Wed, 2 h Thu-Fri, and 4 h next week on Fri-Sun (set in `src/lib/statusConfig.ts`) |

## Folder guide

- `supabase/schema.sql`: the whole database (tables, rules, functions).
- `src/pages`: the three screens. `src/components`: the grid and shared pieces. `src/lib`: time zones, API, session.
- `src/lib/demoApi.ts`: the in-browser demo backend (used only when no database is configured).
- `tests/`: run `npm test` to check the time zone math and every database function.
- `PRODUCT.md`, `DESIGN.md`: product and design notes for anyone changing the tool later.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run locally |
| `npm run build` | Check types and build the site into `dist` |
| `npm test` | Time zone tests and database tests (runs a temporary local database) |

To change the minimum notice, edit `LEAD_MINUTES` in `src/lib/time.ts` and the `150 minutes` backstop in `supabase/schema.sql` (about half an hour under the site's rule).
