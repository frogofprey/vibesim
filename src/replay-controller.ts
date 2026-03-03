import * as fs from 'fs';
import * as path from 'path';
import { broadcastHeartRate } from './server';
import { generateGaussianNoise } from './simulator';

export type ReplayProfile = 'profile1' | 'profile2' | 'profile3' | 'profile4' | 'profile5' | 'profile6';

interface ReplayDataPoint {
  time: number;
  heartRate: number;
}

interface InterpolatedDataPoint {
  time: number;
  heartRate: number;
  isOriginal: boolean; // true if from CSV, false if interpolated
}

interface ReplayState {
  profile: ReplayProfile;
  data: ReplayDataPoint[];
  interpolatedData: InterpolatedDataPoint[];
  currentIndex: number;
  startTime: number;
  lastHeartRate: number | null;
  timeoutIds: NodeJS.Timeout[];
  isRunning: boolean;
  dataRate: number; // Hz
  noiseVariance: number; // BPM
  enableInterpolation: boolean;
}

let replayState: ReplayState | null = null;

/**
 * Parse CSV file and return array of data points
 */
function parseCSV(filePath: string): ReplayDataPoint[] {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    
    // Skip header line
    const dataLines = lines.slice(1);
    
    const data: ReplayDataPoint[] = [];
    for (const line of dataLines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const [timeStr, heartRateStr] = trimmed.split(',');
      const time = parseFloat(timeStr);
      const heartRate = parseInt(heartRateStr, 10);
      
      if (isNaN(time) || isNaN(heartRate)) {
        console.warn(`Skipping invalid line: ${line}`);
        continue;
      }
      
      data.push({ time, heartRate });
    }
    
    return data;
  } catch (error) {
    console.error(`Error parsing CSV file ${filePath}:`, error);
    throw error;
  }
}

/**
 * Load replay data for a profile
 */
function loadReplayData(profile: ReplayProfile): ReplayDataPoint[] {
  let fileName: string;
  if (profile === 'profile1') {
    fileName = 'profile1.csv';
  } else if (profile === 'profile2') {
    fileName = 'profile2.csv';
  } else if (profile === 'profile3') {
    fileName = 'profile3.csv';
  } else if (profile === 'profile4') {
    fileName = 'profile4.csv';
  } else if (profile === 'profile5') {
    fileName = 'profile5.csv';
  } else {
    fileName = 'profile6.csv';
  }
  const filePath = path.join(__dirname, '..', fileName);
  
  console.log(`Loading replay data from ${fileName}...`);
  const data = parseCSV(filePath);
  console.log(`Loaded ${data.length} data points from ${fileName}`);
  
  return data;
}

/**
 * Interpolate data points to target data rate.
 * User-selected rate is primary (spacing = 1/dataRate). Minimum 400ms between points
 * is enforced as a fallback to avoid overloading the interface.
 */
function interpolateDataPoints(
  data: ReplayDataPoint[], 
  dataRate: number,
  enableInterpolation: boolean = true
): InterpolatedDataPoint[] {
  if (data.length === 0) {
    return [];
  }
  
  const interpolated: InterpolatedDataPoint[] = [];
  
  // If interpolation is disabled, return only original CSV points
  if (!enableInterpolation) {
    for (let i = 0; i < data.length; i++) {
      interpolated.push({
        time: data[i].time,
        heartRate: data[i].heartRate,
        isOriginal: true
      });
    }
    return interpolated;
  }
  
  // Interpolation enabled - user rate primary, 400ms minimum as fallback
  const targetInterval = 1.0 / dataRate; // seconds
  const minIntervalSeconds = 0.4; // minimum 400ms between any two points (safety cap)
  
  for (let i = 0; i < data.length; i++) {
    const currentPoint = data[i];
    
    // Always include original CSV point
    interpolated.push({
      time: currentPoint.time,
      heartRate: currentPoint.heartRate,
      isOriginal: true
    });
    
    // If not the last point, interpolate to next point
    if (i < data.length - 1) {
      const nextPoint = data[i + 1];
      const gap = nextPoint.time - currentPoint.time;
      
      if (gap > 0) {
        // Only interpolate if gap is larger than target interval
        // If CSV data is already at or denser than target rate, no interpolation needed
        if (gap > targetInterval) {
          // User rate is primary; 400ms floor avoids overloading the interface
          const actualInterval = Math.max(targetInterval, minIntervalSeconds);
          
          // Generate interpolated points; only add if at least 400ms before next original
          let t = currentPoint.time + actualInterval;
          while (t < nextPoint.time) {
            if (nextPoint.time - t >= minIntervalSeconds) {
              // Linear interpolation
              const ratio = (t - currentPoint.time) / gap;
              const interpolatedHR = currentPoint.heartRate + 
                (nextPoint.heartRate - currentPoint.heartRate) * ratio;
              
              interpolated.push({
                time: t,
                heartRate: interpolatedHR,
                isOriginal: false
              });
            }
            t += actualInterval;
          }
        }
        // If gap <= targetInterval, CSV is already dense enough, skip interpolation
      }
    }
  }
  
  // Sort by time to ensure correct order
  interpolated.sort((a, b) => a.time - b.time);
  
  return interpolated;
}

/**
 * Schedule next HR value to be sent
 */
function scheduleNextHR(): void {
  if (!replayState || !replayState.isRunning) {
    return;
  }
  
  const { interpolatedData, currentIndex, profile, noiseVariance } = replayState;
  
  if (currentIndex >= interpolatedData.length) {
    // Loop back to start
    replayState.currentIndex = 0;
    replayState.lastHeartRate = null; // Reset filter
    replayState.startTime = Date.now(); // Next cycle 1:1 with wall time from now
    console.log(`Replay looped back to start for ${profile}`);
    scheduleNextHR();
    return;
  }
  
  const currentPoint = interpolatedData[currentIndex];
  const deviceId = `replay-${profile}`;
  
  // Apply noise only to interpolated points (not original CSV points)
  let rawHR: number;
  if (currentPoint.isOriginal) {
    // Raw CSV point: no noise
    rawHR = currentPoint.heartRate;
  } else {
    // Interpolated point: add noise
    rawHR = currentPoint.heartRate + generateGaussianNoise(noiseVariance);
  }
  
  // Apply low pass filter: 0.6 * current + 0.4 * last
  let filteredHR: number;
  if (replayState.lastHeartRate !== null) {
    filteredHR = 0.6 * rawHR + 0.4 * replayState.lastHeartRate;
  } else {
    // First measurement, no filter
    filteredHR = rawHR;
  }
  replayState.lastHeartRate = filteredHR;
  
  const heartRate = Math.round(filteredHR);
  
  // Log point details before broadcasting
  if (currentPoint.isOriginal) {
    console.log(`📊 [Replay] Original CSV point [${currentIndex}]: t=${currentPoint.time.toFixed(2)}s, HR=${currentPoint.heartRate} → filtered=${filteredHR.toFixed(1)} (no noise)`);
  } else {
    const noise = rawHR - currentPoint.heartRate;
    console.log(`🔗 [Replay] Interpolated point [${currentIndex}]: t=${currentPoint.time.toFixed(2)}s, baseHR=${currentPoint.heartRate.toFixed(1)}, noise=${noise.toFixed(1)}, rawHR=${rawHR.toFixed(1)} → filtered=${filteredHR.toFixed(1)}`);
  }
  
  // Broadcast HR data
  broadcastHeartRate(deviceId, heartRate, 'hr');
  
  // Increment index for next iteration
  replayState.currentIndex++;
  
  // Loop back to start if we've reached the end
  if (replayState.currentIndex >= interpolatedData.length) {
    replayState.currentIndex = 0;
    replayState.lastHeartRate = null; // Reset filter
    replayState.startTime = Date.now(); // Next cycle 1:1 with wall time from now
    console.log(`Replay looped back to start for ${profile}`);
    scheduleNextHR();
    return;
  }
  
  // Time-based scheduling: emit next point at wall time that matches its replay time
  const nextPoint = interpolatedData[replayState.currentIndex];
  const T0 = interpolatedData[0].time;
  const T_next = nextPoint.time;
  // Schedule next point so replay time advances 1 sec per 1 sec wall time (startTime set at start or on skip)
  let delayMs = (replayState.startTime + (T_next - T0) * 1000) - Date.now();
  // Cap only when delay would be large (e.g. after skip before we updated startTime); normal replay stays real-time
  const intervalMs = 1000 / replayState.dataRate;
  const maxDelayMs = Math.max(intervalMs * 2, 2000);
  if (delayMs > maxDelayMs) delayMs = intervalMs;
  delayMs = Math.max(10, delayMs); // min 10ms to avoid tight loops if slightly behind
  
  const timeoutId = setTimeout(() => {
    if (replayState && replayState.isRunning) {
      scheduleNextHR();
    }
  }, delayMs);
  
  replayState.timeoutIds.push(timeoutId);
}

/**
 * Start replaying HR data from a CSV file
 */
export function startReplay(
  profile: ReplayProfile, 
  dataRate: number = 1.0, 
  noiseVariance: number = 2.0,
  enableInterpolation: boolean = true
): void {
  if (replayState && replayState.isRunning) {
    console.log('Replay already running');
    return;
  }
  
  // Validate data rate
  if (dataRate < 0.1 || dataRate > 2.0) {
    throw new Error(`Data rate must be between 0.1 and 2.0 Hz, got ${dataRate}`);
  }
  
  // Stop any existing replay
  stopReplay();
  
  // Load data
  const data = loadReplayData(profile);
  
  if (data.length === 0) {
    throw new Error(`No data loaded for ${profile}`);
  }
  
  // Interpolate data points (or just use original if interpolation disabled)
  const interpolatedData = interpolateDataPoints(data, dataRate, enableInterpolation);
  
  replayState = {
    profile,
    data,
    interpolatedData,
    currentIndex: 0,
    startTime: Date.now(),
    lastHeartRate: null,
    timeoutIds: [],
    isRunning: true,
    dataRate,
    noiseVariance,
    enableInterpolation
  };
  
  const interpolationStatus = enableInterpolation ? 'enabled' : 'disabled';
  console.log(`Starting replay for ${profile} with ${data.length} raw data points, ${interpolatedData.length} total points`);
  console.log(`Data rate: ${dataRate} Hz, Noise variance: ${noiseVariance} BPM, Interpolation: ${interpolationStatus}`);
  
  // Start replaying from first data point
  scheduleNextHR();
}

/**
 * Stop the current replay
 */
export function stopReplay(): void {
  if (!replayState) {
    return;
  }
  
  // Clear all scheduled timeouts
  replayState.timeoutIds.forEach(timeoutId => {
    clearTimeout(timeoutId);
  });
  
  const profile = replayState.profile;
  replayState.isRunning = false;
  replayState = null;
  
  console.log(`Stopped replay for ${profile}`);
}

/**
 * Check if replay is currently running
 */
export function isReplayRunning(): boolean {
  return replayState?.isRunning ?? false;
}

/**
 * Get current replay profile
 */
export function getCurrentReplayProfile(): ReplayProfile | null {
  return replayState?.profile ?? null;
}

/**
 * Update data rate while replay is running
 */
export function updateReplayDataRate(rate: number): void {
  if (!replayState || !replayState.isRunning) {
    throw new Error('Replay is not running');
  }
  
  if (rate < 0.1 || rate > 2.0) {
    throw new Error(`Data rate must be between 0.1 and 2.0 Hz, got ${rate}`);
  }
  
  // Re-interpolate data with new rate
  const interpolatedData = interpolateDataPoints(replayState.data, rate);
  
  // Update state
  replayState.dataRate = rate;
  replayState.interpolatedData = interpolatedData;
  
  // Reset to current time position (find closest point)
  // For simplicity, reset to start - could be enhanced to maintain position
  replayState.currentIndex = 0;
  replayState.lastHeartRate = null;
  
  console.log(`Replay data rate updated to ${rate} Hz, ${interpolatedData.length} interpolated points`);
}

/**
 * Update noise variance while replay is running
 */
export function updateReplayNoiseVariance(variance: number): void {
  if (!replayState || !replayState.isRunning) {
    throw new Error('Replay is not running');
  }
  
  replayState.noiseVariance = variance;
  console.log(`Replay noise variance updated to ${variance} BPM`);
}

/**
 * Get current data rate
 */
export function getReplayDataRate(): number | null {
  return replayState?.dataRate ?? null;
}

/**
 * Update interpolation setting (only when stopped)
 */
export function updateReplayInterpolation(enabled: boolean): void {
  if (replayState && replayState.isRunning) {
    throw new Error('Cannot change interpolation setting while replay is running');
  }
  
  // This will be applied when replay is next started
  // For now, just validate the parameter
  if (typeof enabled !== 'boolean') {
    throw new Error('Interpolation setting must be a boolean');
  }
}

/**
 * Skip ahead 1 minute in the replay data
 */
export function skipAheadOneMinute(): void {
  if (!replayState || !replayState.isRunning) {
    throw new Error('Replay is not running');
  }
  
  const currentPoint = replayState.interpolatedData[replayState.currentIndex];
  const targetTime = currentPoint.time + 60; // Add 60 seconds
  
  // Find index where time >= targetTime
  let newIndex = replayState.currentIndex;
  for (let i = replayState.currentIndex; i < replayState.interpolatedData.length; i++) {
    if (replayState.interpolatedData[i].time >= targetTime) {
      newIndex = i;
      break;
    }
  }
  
  // If we reached the end without finding a point, loop to start
  if (newIndex === replayState.currentIndex && targetTime > currentPoint.time) {
    // Check if we're near the end - if so, loop to start
    const lastPoint = replayState.interpolatedData[replayState.interpolatedData.length - 1];
    if (targetTime > lastPoint.time) {
      newIndex = 0; // Loop to start
      replayState.lastHeartRate = null; // Reset filter when looping
    } else {
      // Shouldn't happen, but if it does, just move to next point
      newIndex = Math.min(replayState.currentIndex + 1, replayState.interpolatedData.length - 1);
    }
  }
  
  const oldTime = currentPoint.time;
  const newTime = replayState.interpolatedData[newIndex].time;
  replayState.currentIndex = newIndex;
  
  // Align wall clock so the skipped-to position is "now"; otherwise we'd wait for wall time to catch up and no HR would be sent
  const T0 = replayState.interpolatedData[0].time;
  replayState.startTime = Date.now() - (newTime - T0) * 1000;
  
  // Clear any pending timeouts and reschedule from the new position
  replayState.timeoutIds.forEach((id) => clearTimeout(id));
  replayState.timeoutIds = [];
  scheduleNextHR();
  
  console.log(`Skipped ahead 1 minute: from t=${oldTime.toFixed(2)}s to t=${newTime.toFixed(2)}s`);
}
