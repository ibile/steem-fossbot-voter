# Rota to Payslip

A pay estimator for monthly-paid hourly shift work: enter the shifts you're
rostered for and it works out what should land in your account on payday.

No build step, no server, no network calls — everything is saved in the
browser's local storage. Open `index.html` directly, or host the folder and
install it as an app.

## What it does

- **Rota** — your cut-off, payslip and payday dates up top, then a calendar of
  the pay period. Tap a day, pick a shift type, adjust the hours. You can add a
  photo of the rota and keep it on screen while you tap the days in, paste a
  written rota and have it read, or save the shifts as a calendar file.
- **Breakdown** — the estimate laid out like a real payslip: payments,
  deductions and net payment, with a note explaining every figure.
- **Setup** — rates, shift types, the pay cycle, pension, other deductions and
  the tax/NI thresholds.

## The pay cycle

The default cycle is driven by payday rather than the calendar:

- **Payday** is a fixed day of the month (the 21st by default).
- **The payslip** comes out on the last chosen weekday before payday
  (Wednesday).
- **The cut-off** is the last chosen weekday before the payslip (Sunday).

A pay period runs from the day after the previous cut-off to the current one,
so it is always whole weeks — 28 or 35 days. Anything worked after a cut-off
falls into the next month's pay, which the app says on the Rota tab and handles
by itself. Two other modes are available if your employer works differently:
plain calendar months, or a period starting on a set day of the month.

## Reading a written rota

One shift per line, with a day, a code and optionally hours or a time range:

```
3 N                      night shift on the 3rd, default hours
Mon 4 D 07:00-19:00      hours taken from the time range
05/09 OT 12              day/month plus explicit hours
2026-09-06 AL            ISO date
8 N 11.5                 part shift
Thu 10 LD 7.30-19.30     rota codes: LD, ND, E, L, RD, X, OFF...
```

A bare day number is matched against the period on screen; where a five-week
period holds that day number twice, the one nearest today wins. Anything the
parser can't read is listed rather than silently dropped, and nothing is applied
until you confirm the preview.

## Calendar

**Calendar → This pay period** saves an `.ics` file that Google Calendar, Apple
Calendar and Outlook all import. Each event is keyed to its date, so importing
the same period again updates the shifts instead of duplicating them. Night
shifts cross midnight properly, shift types with no start time become all-day
entries, and rest days are left out. Events carry the shift name and hours —
never your pay.

## How the sums work

Defaults are placeholders — set your own rates on the Setup tab first.

| Line | How it's worked out |
| --- | --- |
| Basic pay | worked hours × basic rate |
| Holiday pay | holiday hours × holiday rate |
| Uplift lines | uplift hours × extra per hour, shown on their own line |
| Tax | monthly free pay from the tax code, then 20/40/45% (Scottish bands optional) |
| National Insurance | 8% between the primary threshold and the upper limit, 2% above |
| Pension | percentage of qualifying earnings; relief at source means you pay 80% |
| Other deductions | fixed amount or a percentage of gross |

Checked against a real monthly payslip: gross, National Insurance and pension
came out to the penny, and net was 31p high because PAYE is worked out
cumulatively across the tax year while this estimates a single month in
isolation.

Every threshold is editable, so a new tax year is a settings change, not a code
change.

## Installing it on a phone

The folder is a progressive web app — `manifest.webmanifest`, a service worker
and two icons alongside the page. Serve it over HTTPS and Chrome on Android
offers **Install app** from its menu; after that it opens from the home screen,
runs offline and keeps its own storage.

The quickest host is GitHub Pages: in the repository's **Settings → Pages**,
publish from this branch, then open
`https://<user>.github.io/<repo>/pay-estimator/` on the phone.

Opening `index.html` from local storage on the phone also works and stays
offline, but a file cannot be installed as an app — Chrome only offers **Add to
Home screen**, which makes a shortcut rather than an installed app.

`service-worker.js` serves the page network-first, so an update reaches an
installed copy on its next launch with signal. Everything else is cache-first;
bump `CACHE` when the shell files change.

## Moving your setup between copies

**Setup → Backup & reset → Save backup file** writes a JSON file with your
rates, shift types and every shift. **Restore from file** reads it back. That is
how you move from a browser to the installed app without typing your rates in
again.
