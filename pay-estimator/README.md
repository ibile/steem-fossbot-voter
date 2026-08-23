# Rota to Payslip

A single-page pay estimator for monthly-paid hourly care work: enter the shifts
you're rostered for and it works out what should land in your account at the end
of the month.

Open `index.html` in any browser — phone, tablet or desktop. There is no build
step, no server and no network call; everything is saved in that browser's local
storage.

## What it does

- **Rota** — a calendar of the pay period. Tap a day, pick a shift type, adjust
  the hours. You can also add a photo of the rota and keep it on screen while you
  tap the days in, or paste a written rota and have it read.
- **Breakdown** — the estimate laid out like a real payslip: payments, deductions
  and net payment, with a note explaining each figure.
- **Setup** — rates, shift types, pension, other deductions, tax and NI
  thresholds, and the pay period.

## Reading a written rota

The parser takes one shift per line and wants a day, a code and optionally hours
or a time range. All of these work:

```
3 N                      night shift on the 3rd, default hours
Mon 4 D 07:00-19:00      hours taken from the time range
05/09 OT 12              day/month plus explicit hours
2026-09-06 AL            ISO date
8 N 11.5                 part shift
Thu 10 LD 7.30-19.30     rota codes: LD, ND, E, L, RD, X, OFF...
```

Anything it can't read is listed rather than silently dropped, and nothing is
applied until you confirm the preview.

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
