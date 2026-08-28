#!/usr/bin/env node
/* Inlines the CSS and every script into one self-contained page.
 *
 * Produces two outputs from the same source:
 *   dist/traction-circle.html  full standalone document — open it anywhere
 *   dist/artifact.html         body-content only, for hosts that supply the
 *                              document shell themselves
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ORDER = [
  'util', 'kinematics', 'events', 'scoring', 'trip',
  'storage', 'alerts', 'sensors', 'simulate', 'exporters', 'charts', 'app'
];

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css', 'app.css'), 'utf8');
const js = ORDER
  .map(n => `/* ===== ${n}.js ===== */\n` + fs.readFileSync(path.join(ROOT, 'js', n + '.js'), 'utf8'))
  .join('\n');

// A closing </script> anywhere in the inlined source would end the block early.
const safeJs = js.replace(/<\/script>/gi, '<\\/script>');

const FONTS = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?' +
  'family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600' +
  '&family=Saira+Condensed:wght@600;700&display=swap">';

const bodyMatch = html.match(/<body>([\s\S]*?)<\/body>/);
if (!bodyMatch) throw new Error('index.html has no <body>');
const body = bodyMatch[1]
  .replace(/\n\s*<script src="js\/[^"]+"><\/script>/g, '')
  .replace(/<!--BUILD:JS-->/, '')
  .trimEnd();

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0B0E13">
<meta name="description" content="Real-time driving telematics: speeding, braking and cornering scored from your phone's own sensors.">
<title>Traction Circle</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${FONTS}
<style>
${css}
</style>
</head>
<body>
${body}
<script>
${safeJs}
</script>
</body>
</html>
`;

const artifact = `<title>Traction Circle</title>
${FONTS}
<style>
${css}
</style>
${body}
<script>
${safeJs}
</script>
`;

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist', 'traction-circle.html'), standalone);
fs.writeFileSync(path.join(ROOT, 'dist', 'artifact.html'), artifact);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.log('dist/traction-circle.html  ' + kb(standalone.length));
console.log('dist/artifact.html         ' + kb(artifact.length));
