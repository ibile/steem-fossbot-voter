# Traction Circle

Real-time driving telematics in a web page. It reads your phone's GPS,
accelerometer and gyroscope while you drive, flags harsh braking, harsh
acceleration, sharp cornering and speeding as they happen, and scores the trip
the way an insurance telematics app does.

Everything runs in the browser. No account, no server, no upload — trips are
saved in this browser's local storage and only leave the device if you export
them yourself.

## Running it

Sensors need a **secure origin**, so `file://` will not do for live tracking.

| How | Command | Notes |
|---|---|---|
| Local server | `npx serve telematics` then open on your phone over the LAN | Needs HTTPS or `localhost` for sensors |
| GitHub Pages | enable Pages for the repo, open `/telematics/` | Easiest way to get it on a phone |
| Single file | open `dist/traction-circle.html` | Demo mode works anywhere; live tracking still needs HTTPS |

On iOS, motion access requires an explicit tap — that is what the
**Start tracking a drive** button is for. Answer both prompts (motion and
location) with allow.

**Demo mode needs no sensors at all.** Setup → Run the demo drive replays a
simulated 17-minute journey through the real pipeline, so you can see the
scoring behave before you drive anywhere.

## How the measurements are made

The awkward part of phone telematics is that the accelerometer reports in the
*device* frame — which depends on however the phone is lying in the cradle —
while scoring needs the *vehicle* frame. Three things solve that:

1. **Vertical axis from gravity.** Gravity is low-passed out of
   `accelerationIncludingGravity`, but only while the reading is plausibly
   static (stopped, or coasting at ~1 g with no turn). Averaging through a hard
   brake is what tilts the axis and corrupts every later reading. The estimate
   is then renormalised to 9.80665 m/s², since any drift in magnitude is error.

2. **Lateral g with no calibration at all.** Yaw rate is the gyroscope
   component along that vertical axis — rotation about vertical is yaw however
   the phone is turned — and lateral acceleration is simply `v × yawRate`. The
   sign convention of `accelerationIncludingGravity` is inconsistent across
   browsers (iOS has reported it inverted), so the sign is *learned* by
   correlating against GPS heading change rather than assumed.

3. **Forward axis by correlation.** The horizontal accelerometer vector is
   correlated against the GPS-derived longitudinal acceleration during
   straight-line speed changes. Once converged, high-frequency accelerometer
   detail is blended onto the low-frequency GPS trend with a complementary
   filter — GPS supplies drift-free truth, the IMU supplies the sharp onset of
   a brake that 1 Hz sampling would smear away.

Speed itself comes from a constant-acceleration Kalman filter over GPS, which
yields longitudinal g as a state rather than by differentiating noisy samples.

Degradation is graceful: no gyroscope falls back to GPS heading rate; no motion
sensors at all still scores from GPS alone.

## How the score is built

| Measure | Weight | Basis |
|---|---|---|
| Speed | 25% | time-weighted mean exceedance above the limit |
| Braking | 22% | severity-weighted events per 100 km |
| Cornering | 20% | severity-weighted events per 100 km |
| Acceleration | 15% | severity-weighted events per 100 km |
| Smoothness | 8% | RMS jerk (floored at 55 — a secondary signal) |
| Focus | 6% | screen taps while moving |
| Context | 4% | night driving, hours without a break |

- Events are **normalised per 100 km**, not counted raw. Two harsh brakes on a
  200 km run is careful driving; two on a 2 km trip is not.
- Severity is weighted (mild 1, harsh 2.5, severe 5) so an emergency stop and a
  firm one are not the same event.
- Each channel decays exponentially — `100 × exp(-k × rate)` — so there are no
  cliff edges and no way for one bad moment to zero you out. Constants are
  anchored so roughly 3 weighted events per 100 km scores ~90, 10 scores ~70
  and 25 scores ~40.
- Speeding uses **mean exceedance**, not time-over-limit. Sitting 2 mph over for
  an hour and 25 mph over for five minutes are very different risks.
- A measure that could not be observed is dropped and the weights renormalise,
  so a trip with no speed limit set is scored honestly on the rest rather than
  being given a free 100 or a silent 0.
- Trips under 1 mile or 3 minutes are flagged **provisional** — a per-100 km
  rate computed over 400 m is not a measurement.
- Multi-trip scores sum exposure first and score once, so a 500 m trip cannot
  outvote a 200 km one.

Thresholds sit where the industry generally puts them — about 0.30 g
noticeable, 0.40 g harsh, 0.52 g severe — adjustable in Setup.

## What this is not

- **It cannot track in the background.** A browser tab is not a native app: the
  screen must stay on and the page must stay open. It will not silently log
  every journey.
- **It has no map-matched speed limit data.** You set the limit as you drive.
  Speed is only scored over the portion of the trip where a limit was known,
  and the trip says so when it was not.
- **It is not accepted by any insurer.** It is a mirror of your own driving,
  useful for seeing what these apps measure and how it feels to be scored —
  not a substitute for their telemetry.

## Layout

```
telematics/
  index.html           app shell
  css/app.css
  js/
    util.js            math, formatting
    kinematics.js      sensor fusion, vehicle-frame motion
    events.js          hysteresis event detection
    scoring.js         the scoring model
    trip.js            per-journey pipeline and accumulators
    storage.js         local persistence
    alerts.js          tones, speech, vibration
    sensors.js         hardware access and capability probing
    simulate.js        synthetic drive generator
    exporters.js       GPX / CSV / JSON
    charts.js          canvas instruments
    app.js             screens and wiring
  build.js             inlines everything into dist/
  dist/                single-file builds
```

`node build.js` regenerates `dist/traction-circle.html` (standalone document)
and `dist/artifact.html` (body content only, for hosts that supply the shell).

## Exports

GPX (route plus events as waypoints), CSV (one row per event) and JSON (the
full record including every accumulator). If the browser blocks downloads —
some embedded viewers do — the copy-to-clipboard button returns the same data.
