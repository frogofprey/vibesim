import * as fs from 'fs';
import * as path from 'path';
import { broadcastHeartRate } from './server';

export type ReplayProfile = 'profile1' | 'profile2';

interface ReplayDataPoint {
  time: number;
  heartRate: number;
}

interface ReplayState {
  profile: ReplayProfile;
  data: ReplayDataPoint[];
  currentIndex: number;
  startTime: number;
  lastHeartRate: number | null;
  timeoutIds: NodeJS.Timeout[];
  isRunning: boolean;
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
  const fileName = profile === 'profile1' ? 'profile1.csv' : 'profile2.csv';
  const filePath = path.join(__dirname, '..', fileName);
  
  console.log(`Loading replay data from ${fileName}...`);
  const data = parseCSV(filePath);
  console.log(`Loaded ${data.length} data points from ${fileName}`);
  
  return data;
}

/**
 * Schedule next HR value to be sent
 */
function scheduleNextHR(): void {
  if (!replayState || !replayState.isRunning) {
    return;
  }
  
  const { data, currentIndex, profile } = replayState;
  
  if (currentIndex >= data.length) {
    // Loop back to start
    replayState.currentIndex = 0;
    replayState.lastHeartRate = null; // Reset filter
    console.log(`Replay looped back to start for ${profile}`);
    // Continue with first data point
    scheduleNextHR();
    return;
  }
  
  const currentPoint = data[currentIndex];
  const deviceId = `replay-${profile}`;
  
  // Apply low pass filter: 0.6 * current + 0.4 * last
  let filteredHR: number;
  if (replayState.lastHeartRate !== null) {
    filteredHR = 0.6 * currentPoint.heartRate + 0.4 * replayState.lastHeartRate;
  } else {
    // First measurement, no filter
    filteredHR = currentPoint.heartRate;
  }
  replayState.lastHeartRate = filteredHR;
  
  const heartRate = Math.round(filteredHR);
  
  // Broadcast HR data
  broadcastHeartRate(deviceId, heartRate, 'hr');
  
  // Calculate delay until next data point
  let delay: number;
  if (currentIndex < data.length - 1) {
    const nextPoint = data[currentIndex + 1];
    delay = (nextPoint.time - currentPoint.time) * 1000; // Convert to milliseconds
  } else {
    // Last point - delay before looping back to start
    // Use the interval from second-to-last to last, or default to 1 second
    if (data.length > 2) {
      const prevPoint = data[data.length - 2];
      delay = (currentPoint.time - prevPoint.time) * 1000;
    } else if (data.length === 2) {
      const firstPoint = data[0];
      delay = (currentPoint.time - firstPoint.time) * 1000;
    } else {
      delay = 1000; // Default 1 second if only one data point
    }
  }
  
  // Ensure minimum delay of 10ms to prevent too rapid updates
  delay = Math.max(10, delay);
  
  // Increment index for next iteration
  replayState.currentIndex++;
  
  // Schedule next update
  const timeoutId = setTimeout(() => {
    if (replayState && replayState.isRunning) {
      scheduleNextHR();
    }
  }, delay);
  
  replayState.timeoutIds.push(timeoutId);
}

/**
 * Start replaying HR data from a CSV file
 */
export function startReplay(profile: ReplayProfile): void {
  if (replayState && replayState.isRunning) {
    console.log('Replay already running');
    return;
  }
  
  // Stop any existing replay
  stopReplay();
  
  // Load data
  const data = loadReplayData(profile);
  
  if (data.length === 0) {
    throw new Error(`No data loaded for ${profile}`);
  }
  
  replayState = {
    profile,
    data,
    currentIndex: 0,
    startTime: Date.now(),
    lastHeartRate: null,
    timeoutIds: [],
    isRunning: true
  };
  
  console.log(`Starting replay for ${profile} with ${data.length} data points`);
  
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
