import { SimulationProfile } from '../types';

/**
 * Heart Rate Simulation Profiles
 * Baseline MHR: 163 (for age 57)
 */

const getFitterCardio = (elapsedSeconds: number): number => {
  // Pattern: Warmup (3m) -> Intervals (High/Low)
  // Target: 130 - 150 BPM (80-92% MHR)
  if (elapsedSeconds < 180) return 100 + (elapsedSeconds / 6); // Steady climb
  return (Math.floor(elapsedSeconds / 60) % 2 === 0) ? 148 : 125; // 1m Sprints / 1m Recover
};

const loseWeightMetabolic = (elapsedSeconds: number): number => {
  // Pattern: "The Fat-Burn Pocket" (Zone 2)
  // Target: 105 - 118 BPM (65-72% MHR)
  return 112; // Steady-state aerobic focus
};

const getStrongerStrength = (elapsedSeconds: number): number => {
  // Pattern: Sawtooth (Spike during set, crash during rest)
  // Target: 80 (Rest) -> 135 (Set)
  const setCycle = elapsedSeconds % 120; // 2 minute cycles
  return (setCycle < 40) ? 135 : 85; // 40s set, 80s rest
};

const feelBetterWellness = (elapsedSeconds: number): number => {
  // Pattern: Parasympathetic Drift (Downward trend)
  // Target: 65 - 80 BPM
  const drift = Math.max(65, 80 - (elapsedSeconds / 60)); 
  return drift;
};

export const getSimulatedHeartRate = (profile: SimulationProfile, elapsedSeconds: number): number => {
  switch (profile) {
    case SimulationProfile.CARDIO:
      return getFitterCardio(elapsedSeconds);
    case SimulationProfile.METABOLIC:
      return loseWeightMetabolic(elapsedSeconds);
    case SimulationProfile.STRENGTH:
      return getStrongerStrength(elapsedSeconds);
    case SimulationProfile.WELLNESS:
      return feelBetterWellness(elapsedSeconds);
    default:
      return 70;
  }
};

export const generateGaussianNoise = (mean: number, sigma: number): number => {
  let u1 = 0, u2 = 0;
  // Convert [0,1) to (0,1)
  while (u1 === 0) u1 = Math.random();
  while (u2 === 0) u2 = Math.random();
  
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * sigma;
};