import { broadcastHeartRate } from './server';

export type Profile = 'getFitter' | 'loseWeight' | 'getStronger' | 'feelBetter' | 'warmupRecovery';

// Profile-specific parameter interfaces
export interface GetFitterParams {
  cycleLength: number; // seconds
  highIntensityDuration: number; // seconds
  lowHR: number; // BPM
  highHR: number; // BPM
}

export interface LoseWeightParams {
  baseHR: number; // BPM
  variationAmplitude: number; // BPM
  variationPeriod: number; // seconds
}

export interface GetStrongerParams {
  cycleLength: number; // seconds
  burstDuration: number; // seconds
  baselineHR: number; // BPM
  peakHR: number; // BPM
}

export interface FeelBetterParams {
  baseHR: number; // BPM
  variationAmplitude: number; // BPM
  variationPeriod: number; // seconds
}

// Union type for all profile parameters
export type ProfileParameters = 
  | { profile: 'getFitter'; params: GetFitterParams }
  | { profile: 'loseWeight'; params: LoseWeightParams }
  | { profile: 'getStronger'; params: GetStrongerParams }
  | { profile: 'feelBetter'; params: FeelBetterParams }
  | { profile: 'warmupRecovery'; params: FeelBetterParams };

// Default parameter values matching current hardcoded values
export const defaultProfileParameters = {
  getFitter: {
    cycleLength: 60,
    highIntensityDuration: 20,
    lowHR: 120,
    highHR: 180
  } as GetFitterParams,
  loseWeight: {
    baseHR: 135,
    variationAmplitude: 5,
    variationPeriod: 30
  } as LoseWeightParams,
  getStronger: {
    cycleLength: 90,
    burstDuration: 15,
    baselineHR: 110,
    peakHR: 170
  } as GetStrongerParams,
  feelBetter: {
    baseHR: 100,
    variationAmplitude: 10,
    variationPeriod: 45
  } as FeelBetterParams,
  warmupRecovery: {
    baseHR: 80,
    variationAmplitude: 3,
    variationPeriod: 45
  } as FeelBetterParams
};

interface SimulationState {
  profile: Profile;
  startTime: number;
  intervalId: NodeJS.Timeout | null;
  deviceId: string;
  variance: number;
  lastHeartRate: number | null; // For low pass filter
  profileParams: ProfileParameters;
}

let simulationState: SimulationState | null = null;

/**
 * Generate Gaussian noise with specified variance
 * @param variance - Variance in BPM (default: 2)
 * @returns Random noise value following Gaussian distribution
 */
export function generateGaussianNoise(variance: number = 2): number {
  // Box-Muller transform to generate Gaussian random numbers
  let u1 = 0, u2 = 0;
  while (u1 === 0) u1 = Math.random(); // Converting [0,1) to (0,1)
  while (u2 === 0) u2 = Math.random();
  
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * Math.sqrt(variance);
}

/**
 * GetFitter profile: HIIT spikes
 * Simulates high-intensity interval training with spikes
 * @param elapsedSeconds - Time elapsed since simulation start
 * @param params - Profile parameters
 * @returns Base heart rate value
 */
export function getFitter(elapsedSeconds: number, params: GetFitterParams): number {
  const cyclePosition = elapsedSeconds % params.cycleLength;
  const recoveryDuration = params.cycleLength - params.highIntensityDuration;
  
  if (cyclePosition < params.highIntensityDuration) {
    // High intensity: ramp up from lowHR to highHR
    const intensity = cyclePosition / params.highIntensityDuration;
    return params.lowHR + (intensity * (params.highHR - params.lowHR));
  } else {
    // Recovery: ramp down from highHR to lowHR
    const recoveryProgress = (cyclePosition - params.highIntensityDuration) / recoveryDuration;
    return params.highHR - (recoveryProgress * (params.highHR - params.lowHR));
  }
}

/**
 * LoseWeight profile: steady-state Zone 2
 * Maintains consistent Zone 2 heart rate (60-70% max HR)
 * @param elapsedSeconds - Time elapsed since simulation start
 * @param params - Profile parameters
 * @returns Base heart rate value
 */
export function loseWeight(elapsedSeconds: number, params: LoseWeightParams): number {
  // Zone 2: steady state with sinusoidal variation
  const variation = Math.sin(elapsedSeconds / params.variationPeriod) * params.variationAmplitude;
  return params.baseHR + variation;
}

/**
 * GetStronger profile: bursts
 * Simulates strength training with bursts of intensity
 * @param elapsedSeconds - Time elapsed since simulation start
 * @param params - Profile parameters
 * @returns Base heart rate value
 */
export function getStronger(elapsedSeconds: number, params: GetStrongerParams): number {
  const cyclePosition = elapsedSeconds % params.cycleLength;
  const restDuration = params.cycleLength - params.burstDuration;
  
  if (cyclePosition < params.burstDuration) {
    // Burst: quick spike from baselineHR to peakHR
    const intensity = cyclePosition / params.burstDuration;
    return params.baselineHR + (intensity * (params.peakHR - params.baselineHR));
  } else {
    // Rest: return from peakHR to baselineHR
    const restProgress = (cyclePosition - params.burstDuration) / restDuration;
    return params.peakHR - (restProgress * (params.peakHR - params.baselineHR));
  }
}

/**
 * FeelBetter profile: low intensity
 * Gentle, low-intensity exercise
 * @param elapsedSeconds - Time elapsed since simulation start
 * @param params - Profile parameters
 * @returns Base heart rate value
 */
export function feelBetter(elapsedSeconds: number, params: FeelBetterParams): number {
  // Low intensity: baseHR with sinusoidal variation
  const variation = Math.sin(elapsedSeconds / params.variationPeriod) * params.variationAmplitude;
  return params.baseHR + variation;
}

/**
 * Get the base heart rate for a given profile at a specific time
 * @param profileParams - The profile and its parameters
 * @param elapsedSeconds - Time elapsed since simulation start
 * @returns Base heart rate value (without noise)
 */
export function getBaseHeartRate(profileParams: ProfileParameters, elapsedSeconds: number): number {
  if (profileParams.profile === 'getFitter') {
    return getFitter(elapsedSeconds, profileParams.params);
  } else if (profileParams.profile === 'loseWeight') {
    return loseWeight(elapsedSeconds, profileParams.params);
  } else if (profileParams.profile === 'getStronger') {
    return getStronger(elapsedSeconds, profileParams.params);
  } else if (profileParams.profile === 'feelBetter') {
    return feelBetter(elapsedSeconds, profileParams.params);
  } else if (profileParams.profile === 'warmupRecovery') {
    return feelBetter(elapsedSeconds, profileParams.params);
  } else {
    throw new Error(`Unknown profile: ${(profileParams as any).profile}`);
  }
}

/**
 * Start a heart rate simulation
 * @param profile - The fitness profile to simulate
 * @param deviceId - Device identifier (default: 'simulator-001')
 * @param variance - Noise variance in BPM (default: 2)
 * @param intervalMs - Update interval in milliseconds (default: 1000ms = 1 second)
 * @param profileParams - Optional profile parameters (uses defaults if not provided)
 */
export function startSimulation(
  profile: Profile,
  deviceId: string = 'simulator-001',
  variance: number = 2,
  intervalMs: number = 1000,
  profileParams?: ProfileParameters
): void {
  // If simulation is already running, just update the profile/variance
  if (simulationState && simulationState.intervalId) {
    updateSimulationProfile(profile);
    updateSimulationVariance(variance);
    if (profileParams) {
      updateProfileParameters(profileParams);
    }
    return;
  }

  // Stop any existing simulation
  stopSimulation();

  // Create profile parameters if not provided
  let params: ProfileParameters;
  if (profileParams) {
    params = profileParams;
  } else {
    switch (profile) {
      case 'getFitter':
        params = { profile: 'getFitter', params: defaultProfileParameters.getFitter };
        break;
      case 'loseWeight':
        params = { profile: 'loseWeight', params: defaultProfileParameters.loseWeight };
        break;
      case 'getStronger':
        params = { profile: 'getStronger', params: defaultProfileParameters.getStronger };
        break;
      case 'feelBetter':
        params = { profile: 'feelBetter', params: defaultProfileParameters.feelBetter };
        break;
      case 'warmupRecovery':
        params = { profile: 'warmupRecovery', params: defaultProfileParameters.warmupRecovery };
        break;
    }
  }

  const startTime = Date.now();
  simulationState = {
    profile,
    startTime,
    intervalId: null,
    deviceId,
    variance,
    lastHeartRate: null,
    profileParams: params
  };

  console.log(`Starting ${profile} simulation (device: ${deviceId}, variance: ${variance} BPM)`);

  // Start the simulation loop
  simulationState.intervalId = setInterval(() => {
    if (!simulationState) return;

    const elapsedSeconds = (Date.now() - simulationState.startTime) / 1000;
    const baseHR = getBaseHeartRate(simulationState.profileParams as ProfileParameters, elapsedSeconds);
    const noise = generateGaussianNoise(simulationState.variance);
    const rawHeartRate = baseHR + noise;

    // Apply low pass filter: 0.6 * current + 0.4 * last
    let filteredHR: number;
    if (simulationState.lastHeartRate !== null) {
      filteredHR = 0.6 * rawHeartRate + 0.4 * simulationState.lastHeartRate;
    } else {
      // First measurement, no filter
      filteredHR = rawHeartRate;
    }
    
    simulationState.lastHeartRate = filteredHR;

    // Round and ensure heart rate is within reasonable bounds (50-200 BPM)
    const clampedHR = Math.max(50, Math.min(200, Math.round(filteredHR)));

    // Broadcast via WebSocket server with 'hr' action
    broadcastHeartRate(simulationState.deviceId, clampedHR, 'hr');
  }, intervalMs);
}

/**
 * Update simulation profile while running
 */
export function updateSimulationProfile(profile: Profile, deviceId?: string, profileParams?: ProfileParameters): void {
  if (!simulationState) {
    throw new Error('Simulation not running');
  }
  
  const oldProfile = simulationState.profile;
  simulationState.profile = profile;
  // Update device ID to match new profile
  if (deviceId) {
    simulationState.deviceId = deviceId;
  } else {
    // Default to simulator-{profile} format
    simulationState.deviceId = `simulator-${profile}`;
  }
  // Update profile parameters if provided, otherwise use defaults
  if (profileParams) {
    simulationState.profileParams = profileParams;
  } else {
    let newParams: ProfileParameters;
    switch (profile) {
      case 'getFitter':
        newParams = { profile: 'getFitter', params: defaultProfileParameters.getFitter };
        break;
      case 'loseWeight':
        newParams = { profile: 'loseWeight', params: defaultProfileParameters.loseWeight };
        break;
      case 'getStronger':
        newParams = { profile: 'getStronger', params: defaultProfileParameters.getStronger };
        break;
      case 'feelBetter':
        newParams = { profile: 'feelBetter', params: defaultProfileParameters.feelBetter };
        break;
      case 'warmupRecovery':
        newParams = { profile: 'warmupRecovery', params: defaultProfileParameters.warmupRecovery };
        break;
    }
    simulationState.profileParams = newParams;
  }
  // Reset start time to avoid jumps when switching profiles
  simulationState.startTime = Date.now();
  console.log(`Profile changed from ${oldProfile} to ${profile} while running`);
  console.log(`Device ID updated to: ${simulationState.deviceId}`);
}

/**
 * Update simulation variance while running
 */
export function updateSimulationVariance(variance: number): void {
  if (!simulationState) {
    throw new Error('Simulation not running');
  }
  
  const oldVariance = simulationState.variance;
  simulationState.variance = variance;
  console.log(`Variance changed from ${oldVariance} to ${variance} BPM while running`);
}

/**
 * Get current simulation variance
 */
export function getSimulationVariance(): number {
  return simulationState?.variance ?? 2;
}

/**
 * Validate profile parameters
 */
function validateProfileParameters(params: ProfileParameters): void {
  switch (params.profile) {
    case 'getFitter':
      if (params.params.cycleLength <= 0 || params.params.highIntensityDuration <= 0) {
        throw new Error('Cycle length and high intensity duration must be > 0');
      }
      if (params.params.highIntensityDuration >= params.params.cycleLength) {
        throw new Error('High intensity duration must be less than cycle length');
      }
      if (params.params.lowHR < 50 || params.params.lowHR > 200 || 
          params.params.highHR < 50 || params.params.highHR > 200) {
        throw new Error('HR values must be between 50 and 200 BPM');
      }
      if (params.params.lowHR >= params.params.highHR) {
        throw new Error('Low HR must be less than high HR');
      }
      break;
    case 'loseWeight':
      if (params.params.baseHR < 50 || params.params.baseHR > 200) {
        throw new Error('Base HR must be between 50 and 200 BPM');
      }
      if (params.params.variationAmplitude < 0 || params.params.variationAmplitude > 50) {
        throw new Error('Variation amplitude must be between 0 and 50 BPM');
      }
      if (params.params.variationPeriod <= 0 || params.params.variationPeriod > 300) {
        throw new Error('Variation period must be between 1 and 300 seconds');
      }
      break;
    case 'getStronger':
      if (params.params.cycleLength <= 0 || params.params.burstDuration <= 0) {
        throw new Error('Cycle length and burst duration must be > 0');
      }
      if (params.params.burstDuration >= params.params.cycleLength) {
        throw new Error('Burst duration must be less than cycle length');
      }
      if (params.params.baselineHR < 50 || params.params.baselineHR > 200 || 
          params.params.peakHR < 50 || params.params.peakHR > 200) {
        throw new Error('HR values must be between 50 and 200 BPM');
      }
      if (params.params.baselineHR >= params.params.peakHR) {
        throw new Error('Baseline HR must be less than peak HR');
      }
      break;
    case 'feelBetter':
    case 'warmupRecovery':
      if (params.params.baseHR < 50 || params.params.baseHR > 200) {
        throw new Error('Base HR must be between 50 and 200 BPM');
      }
      if (params.params.variationAmplitude < 0 || params.params.variationAmplitude > 50) {
        throw new Error('Variation amplitude must be between 0 and 50 BPM');
      }
      if (params.params.variationPeriod <= 0 || params.params.variationPeriod > 300) {
        throw new Error('Variation period must be between 1 and 300 seconds');
      }
      break;
  }
}

/**
 * Update profile parameters while running
 */
export function updateProfileParameters(profileParams: ProfileParameters): void {
  if (!simulationState) {
    throw new Error('Simulation not running');
  }
  
  // Validate parameters
  validateProfileParameters(profileParams);
  
  // Ensure profile matches
  if (profileParams.profile !== simulationState.profile) {
    throw new Error(`Profile mismatch: expected ${simulationState.profile}, got ${profileParams.profile}`);
  }
  
  simulationState.profileParams = profileParams;
  console.log(`Profile parameters updated for ${profileParams.profile}`);
}

/**
 * Stop the current simulation
 */
export function stopSimulation(): void {
  if (simulationState && simulationState.intervalId) {
    clearInterval(simulationState.intervalId);
    console.log(`Stopped ${simulationState.profile} simulation`);
    simulationState = null;
  }
}

/**
 * Get the current simulation state
 */
export function getSimulationState(): SimulationState | null {
  return simulationState;
}
