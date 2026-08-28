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
- **The payslip** is a chosen weekday (Wednesday) of a chosen week, counted back
  from the week payday falls in — one week back by default.
- **The cut-off** is the last chosen weekday before the payslip (Sunday).

Pinning the payslip to a *week* rather than to "the last Wednesday before
payday" is what keeps the cycle steady: a Friday payday and a Monday payday
otherwise get wildly different gaps. With the defaults the cut-off always lands
on the second Sunday before payday.

A pay period runs from the day after one cut-off to the next, so it is always
whole weeks — 28 or 35 days — and always Monday to Sunday. Each period is named
for the month it is paid in: August 2026 is 13 Jul – 9 Aug, closing Sun 9 Aug,
payslip Wed 12 Aug, money Fri 21 Aug. September 2026 is 10 Aug – 13 Sep, paid
Mon 21 Sep. Switch **Each period is** to *Named for its first month* if you
would rather a period took the name of the month the work starts in.

Anything worked after a cut-off falls into the next period, which the app says
on the Rota tab and handles by itself. Two other modes are available if your
employer works differently: plain calendar months, or a period starting on a
set day of the month.

## Reading a written rota

One shift per line, with a day, a code and optionally hours or a time range:

```
3 N                      night shift on the 3rd, default hours
Mon 4 D 07:00-19:00      hours taken from the time range
05/09 OT 12              day/month plus explicit hours
2026-09-06 AL            ISO date
8 N 11.5                 part shift
Thu 10 LD 7.30-19.30     rota codes: LD, ND, E, L, RD, X, OFF...
30 N 12 + BHT 4          two entries on one day, split on " + "
```

A bare day number is matched against the period on screen; where a five-week
period holds that day number twice, the one nearest today wins. Anything the
parser can't read is listed rather than silently dropped, and nothing is applied
until you confirm the preview.

## Several entries in one day

A day holds a list of entries, not a single shift. That covers a double shift,
a shift split across two rates, and — the case this was built for — hours inside
a shift that earn an enhancement.

Shift types have four pay modes:

| Mode | What the hours do |
| --- | --- |
| Basic + uplift | Paid at basic, plus any uplift, on their own hours |
| Own rate | Paid at the type's own rate instead of basic |
| **Top-up only** | Earn *only* the extra per hour — no basic, no hours added |
| Unpaid | Marks the day, pays nothing |

Every amount can be entered as **£/hr** or as a **× basic** multiplier — tap the
button beside the field to switch. A multiplier states the total rate for those
hours, so double pay is ×2, and it follows the basic rate when that changes
rather than going stale after a pay rise.

### Bank holidays, both ways

Employers express double pay one of two ways, and the app does both. They come
to the same money — use whichever matches how your payslip is laid out:

```
METHOD 1  the whole shift at the bank holiday rate
BH   Bank holiday        4 h    own rate, x2      4 x £26.82 = £107.28

METHOD 2  the hours in basic, the enhancement on its own line
N    Night shift         4 h    basic             4 x £13.41 =  £53.64
BHT  Bank holiday hours  4 h    top-up only, x2   4 x £13.41 =  £53.64
                                                              ─────────
                                                                £107.28
```

**Top-up only** is what makes method 2 work. If a bank holiday falls part-way
through a night shift, the shift is already paying basic for those hours; the
enhancement covers a subset of the same hours and appears as its own payslip
line. Entering it as an ordinary shift would count those hours twice. A
twelve-hour night shift with four qualifying hours is two entries:

```
N    Night shift          12 h     basic on all twelve
BHT  Bank holiday hours    4 h     the enhancement on four of them
```

Twelve basic hours, four hours of enhancement, nothing double counted. The same
pattern handles overtime hours paid as an uplift within a normal shift, which is
how the payslip this was built from is laid out.

Top-up entries do not count towards the shift or hours totals, and they produce
no calendar event, because the shift they sit inside already has one.

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
| Uplift lines | uplift hours × extra per hour (or × basic), on their own line |
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
