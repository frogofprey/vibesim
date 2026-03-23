/**
 * One-off script to generate profile7.csv for Interval Test (3min) replay.
 * Waypoints: linear interpolation between, constant on plateaus; 3 BPM Gaussian noise; 1 row/sec.
 * Run: node scripts/generate-profile7.js
 */
const fs = require('fs');
const path = require('path');

const WAYPOINTS = [
  [0, 80],
  [90, 135],
  [270, 135],
  [300, 115],
  [420, 115],
  [450, 135],
  [630, 135],
  [660, 115],
  [780, 115],
  [810, 135],
  [990, 135],
  [1020, 115],
  [1140, 115],
  [1170, 97],
  [1200, 80],
];

const T_MAX = 1200;

function gaussianNoise(variance) {
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * Math.sqrt(variance);
}

function interpolateHR(t) {
  for (let i = 0; i < WAYPOINTS.length - 1; i++) {
    const [t0, hr0] = WAYPOINTS[i];
    const [t1, hr1] = WAYPOINTS[i + 1];
    if (t >= t0 && t <= t1) {
      if (t0 === t1) return hr0;
      const frac = (t - t0) / (t1 - t0);
      return hr0 + frac * (hr1 - hr0);
    }
  }
  return WAYPOINTS[WAYPOINTS.length - 1][1];
}

const NOISE_VARIANCE = 3;
const MIN_HR = 40;
const MAX_HR = 220;

const rows = ['time,heart_rate'];
for (let t = 0; t <= T_MAX; t++) {
  const base = interpolateHR(t);
  const withNoise = base + gaussianNoise(NOISE_VARIANCE);
  const hr = Math.round(Math.max(MIN_HR, Math.min(MAX_HR, withNoise)));
  rows.push(`${t},${hr}`);
}

const outPath = path.join(__dirname, '..', 'profile7.csv');
fs.writeFileSync(outPath, rows.join('\n') + '\n', 'utf8');
console.log(`Wrote ${rows.length} rows to ${outPath}`);
