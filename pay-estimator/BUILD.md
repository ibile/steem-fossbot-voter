# Rota to Payslip — build notes

Companion to [README.md](README.md). The README says what the app does and how
to use it; this says how it was built, how the pay rules were arrived at, what
was verified and what is still open.

**Status:** working, installable, checked against a real payslip. Single page,
no build step, no dependencies, no backend, no network calls of its own.

---

## What is in the folder

| File | Size | Purpose |
| --- | ---: | --- |
| `index.html` | ~93 KB | The whole app — markup, styles and logic in one file, ~1,875 lines |
| `manifest.webmanifest` | 1.4 KB | App identity, icons, screenshots, shortcuts |
| `service-worker.js` | 1.5 KB | Offline shell; page network-first, everything else cache-first |
| `icon-192.png`, `icon-512.png` | 5 KB | Home-screen icons, one declared maskable |
| `shot-rota.png`, `shot-pay.png` | 156 KB | Screenshots for the install dialog |
| `README.md` | 8.6 KB | Usage and behaviour |

One file for the app is a deliberate choice. It can be emailed, saved to a phone
and opened offline, or hosted as-is — no bundler, no framework, nothing to go
stale. The cost is a large single file; the parts are ordered styles → markup →
logic, and the logic is grouped by section with comment headers.

---

## How the pay maths was derived

The rules were not guessed. They were **back-solved from one real payslip**,
because deductions are formulaic and a payslip is self-checking.

Given a payslip showing gross, tax, National Insurance, pension and net:

1. **National Insurance.** Employee NI is a flat rate on earnings between the
   primary threshold and the upper limit. Solving `NI = r × (gross − PT)` against
   the payslip's figure landed exactly on the published category-A rate and
   monthly threshold. Exact to the penny.
2. **Pension.** Solving for qualifying earnings — `(gross − lower) × rate` —
   came out 20% too high. Multiplying by 0.8 matched exactly, which identifies
   the scheme as **relief at source**: the employee pays 80% and HMRC adds the
   rest. Exact to the penny.
3. **Tax.** Monthly free pay from the tax code, then the basic-rate band. Lands
   within pennies; the residual is explained below.
4. **Everything else** — a fixed non-statutory deduction — reads straight off
   the payslip as a flat amount.

This back-solving is also the most commercially interesting part of the build:
it means an app can configure itself from a photograph of a payslip rather than
asking the user twenty questions.

### Where the residual comes from

Reproducing the payslip gives gross, NI and pension **exact**, and net about 30p
high. That is not a bug to chase: PAYE is cumulative across the tax year, so
each month's tax depends on year-to-date pay and tax paid, while this estimates
a single month in isolation. Closing the gap needs YTD figures carried forward —
see *Open items*.

---

## The pay cycle

Monthly pay driven by payday rather than the calendar. Three settings define it:

```
payday        a fixed day of the month
payslip       a weekday, in a week counted back from the week payday falls in
cut-off       the last given weekday before the payslip
```

A period runs from the day after one cut-off to the next, so it is always a
whole number of weeks — 28 or 35 days — and always aligned to the same weekday.

**Why the payslip is pinned to a week, not to payday.** The first attempt used
"the last Wednesday before payday". That silently breaks: when payday falls on a
Friday the preceding Wednesday is two days earlier, when it falls on a Monday it
is five, so the cut-off wandered by a week between months. Counting whole weeks
back from payday's own week fixes it. With the defaults the cut-off resolves to
the **second Sunday before payday**, every month.

Verified across a full year: every period 28 or 35 days, every boundary
contiguous with the next, and two independently supplied real-world period
boundaries reproduced exactly.

Two other modes exist for employers who work differently — plain calendar
months, and a period starting on a set day of the month.

---

## Data model

```js
settings   { rates, pay cycle, tax/NI/pension thresholds, other deductions, rev }
types      [ { id, code, name, hours, mode, unit, extra|rate|mult, start, hue } ]
shifts     { "YYYY-MM-DD": [ { t: typeId, h: hours }, ... ] }
```

A day holds a **list** of entries, which is what makes split shifts, double
shifts and partial enhancements expressible.

### Pay modes

| Mode | Hours go to | Money |
| --- | --- | --- |
| `base` | basic pool | basic rate + optional uplift |
| `rate` | own line | the type's own rate |
| `topup` | *nowhere* | the extra per hour only |
| `unpaid` | nowhere | nothing |

`topup` is the subtle one and the reason it exists: when an enhancement covers
hours that a shift is **already** paying basic for — bank holiday hours inside a
night shift — adding them as an ordinary entry would count those hours twice.
Top-up hours therefore add no basic pay, no worked hours, no shift count and no
calendar event.

### Amounts

Every money field is either a fixed `£/hr` or a `× basic` multiplier. A
multiplier states the **total** rate for those hours, so the extra is derived as
`(multiplier − 1) × basic`. Double pay is ×2 in both `rate` mode (one line at
twice basic) and `topup` mode (one extra basic on hours already counted) — the
two ways employers express the same money, and they reconcile to the same total.
Multipliers follow the basic rate, so a pay rise cannot leave enhancements
stale.

### Migrations

Saved data carries a `rev` stamp and is upgraded on load. **The check reads the
stored settings, not the merged ones** — the merge fills defaults in first, so a
merged value can never reveal the old state. Getting this wrong made the first
migration a silent no-op.

Revisions so far: pay-cycle defaults corrected (3), days converted from a single
object to a list and top-up types added (4), bank holiday types moved to ×2 (5).
User-customised values are left alone.

---

## Input routes

Three ways in, because the fastest one depends on what the rota looks like:

1. **Tap the calendar.** One tap saves a single-entry day; `+ Another` keeps the
   sheet open for a second entry.
2. **Photograph the rota**, pinned above the calendar while tapping the days in.
   The page cannot read the image itself — see *Open items*.
3. **Type or paste it.** The parser handles bare day numbers, ISO and `d/m`
   dates, 12- and 24-hour time ranges, and common rota codes. `" + "` splits one
   line into several entries on the same day. Nothing is applied until a preview
   is confirmed, and unreadable lines are listed rather than dropped.

Parser decisions worth keeping in mind:

- **Dates are extracted before times.** Doing it the other way round let the
  time-range pattern eat `26-09` out of `2026-09-06`.
- **A dotted date needs two digits and a real month**, so shift lengths like
  `11.5` are not mistaken for 11 May.
- **A bare day number that matches twice** in a five-week period resolves to
  whichever occurrence is nearer today.

---

## Calendar export

Writes `.ics` that Google, Apple and Outlook all import. One event per entry,
`UID` keyed to date and index, so re-importing an amended rota **updates** the
events instead of duplicating them. Night shifts cross midnight properly from a
per-type start time; types with no start time become all-day entries; rest days
and top-ups produce no event.

Events carry the shift name and hours and **never the pay** — work calendars get
shared more often than people expect.

In the hosted preview the file cannot be handed to the device (the sandbox
allows only a fixed set of file types, and `.ics` is not among them), so the app
says so plainly rather than failing silently. From the installed app it is an
ordinary download.

---

## Installing

A progressive web app, served over HTTPS:

- Manifest with `id`, `display_override`, categories, two home-screen shortcuts
  and two narrow-form screenshots, so the install dialog looks like an app
  rather than a bare icon and name.
- The page listens for `beforeinstallprompt` and offers its own **Install**
  button, falling back to per-platform instructions where there is no install
  API — iOS in particular — and reporting installed state when it is running
  standalone.
- Service worker serves the page network-first so updates land, everything else
  cache-first; when a new worker takes over the page offers a reload.

An APK was considered and rejected: it would mean sideloading warnings, no
automatic updates, and an Android SDK toolchain, in exchange for nothing an
installed PWA does not already give on this platform.

---

## Storage and privacy

Everything lives in `localStorage` on the device. No accounts, no servers, no
analytics, no third-party requests beyond the web font stylesheet. The rota
photo is downscaled and stored locally. Backups are a JSON file the user saves
and restores themselves — that is how a setup moves between the preview and an
installed copy.

Every write is wrapped, because storage throws rather than returning null in
private windows and some embedded browsers.

---

## What was verified

| Area | Evidence |
| --- | --- |
| Pay maths | Real payslip reproduced: gross, NI and pension exact; net ~30p high, explained by cumulative PAYE |
| Pay cycle | Full year walked: all periods 28 or 35 days, contiguous, two supplied real boundaries matched |
| Multi-entry | Shift plus two enhancements on one day yields the right basic hours, not the inflated figure |
| Both bank holiday methods | Whole shift at ×2 and basic-plus-top-up produce identical totals |
| Multipliers | Enhancements track a change to the basic rate |
| Parser | 11 notation variants; only genuinely unreadable input is skipped |
| Calendar | Night shifts cross midnight; stable UIDs; top-ups and rest days excluded |
| Migrations | Every earlier revision upgrades, keeping rates, custom types and shifts |
| Install | Chrome's manifest parser reports no errors; all four installability criteria hold |
| Offline | Reload with the network disabled still renders and keeps data |
| Layout | No horizontal overflow at 414 px; both light and dark themes |

Checks were run by driving the real page in Chromium, not by unit-testing the
arithmetic in isolation.

---

## Open items

Ordered by how much they matter to anyone other than the original user.

- **Cumulative PAYE.** Carry year-to-date taxable pay and tax paid to remove the
  residual and handle mid-year starts, irregular months and bonuses.
- **Pay frequencies.** Weekly, fortnightly and four-weekly. Much hourly work is
  not monthly, and the whole period engine currently assumes it is.
- **Percentage enhancements.** NHS unsocial hours is a percentage of basic
  applied to time bands, not a flat rate or a whole-shift multiplier.
- **Reading a payslip photograph.** The architecture that works: OCR on device,
  redact identifiers, send text only for extraction, then **reconcile the
  arithmetic** — gross less deductions equals net, hours times rate equals each
  line — and refuse to show numbers that do not balance. The reconciliation is
  the quality bar, not the OCR.
- **Statutory coverage.** Student loan plans, NI categories beyond A, salary
  sacrifice and net-pay pension arrangements, umbrella/agency deductions.
- **Threshold updates.** Rates change every April and Scotland diverges. These
  should arrive as remote config rather than a code change.

---

## Build log

| Commit | What changed |
| --- | --- |
| `da14d74` | First build: pay engine, calendar, rota parser, payslip breakdown |
| `fbc69e7` | Payday cut-off cycle, `.ics` export, PWA scaffolding |
| `ddacbec` | Cut-off weekday and period naming corrected |
| `2860fb4` | Payslip pinned to payday's week, fixing the wandering cut-off |
| `7f555db` | Several entries per day, plus the top-up pay mode |
| `e6ca0f5` | Amounts as a multiple of basic; bank holidays as double pay |
| `93078f9` | Proper install flow, richer manifest, update prompt |

Three of those seven are corrections to the pay cycle, all from the user
checking output against real payslips. That is the pattern worth keeping if this
is ever built out: **the rules are only ever as good as the payslips they have
been reconciled against.**
