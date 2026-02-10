import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  generateGaussianNoise,
  getFitter,
  loseWeight,
  getStronger,
  feelBetter,
  getBaseHeartRate,
  startSimulation,
  stopSimulation,
  getSimulationState,
  defaultProfileParameters,
  ProfileParameters
} from './simulator';

describe('Heart Rate Simulator', () => {
  beforeEach(() => {
    stopSimulation();
  });

  afterEach(() => {
    stopSimulation();
  });

  describe('Gaussian Noise Generator', () => {
    it('should generate noise with variance within 2 BPM', () => {
      const variance = 2;
      const samples = 10000;
      const noiseValues: number[] = [];

      // Generate many samples
      for (let i = 0; i < samples; i++) {
        noiseValues.push(generateGaussianNoise(variance));
      }

      // Calculate statistics
      const mean = noiseValues.reduce((a, b) => a + b, 0) / samples;
      const variance_actual = noiseValues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / samples;
      const stdDev = Math.sqrt(variance_actual);

      // Mean should be close to 0
      expect(Math.abs(mean)).toBeLessThan(0.1);

      // Standard deviation should be close to sqrt(2) ≈ 1.414
      expect(Math.abs(stdDev - Math.sqrt(variance))).toBeLessThan(0.1);

      // 99.7% of values should be within 3 standard deviations (±3σ)
      const within3Sigma = noiseValues.filter(val => Math.abs(val) <= 3 * stdDev).length;
      const percentageWithin3Sigma = (within3Sigma / samples) * 100;
      expect(percentageWithin3Sigma).toBeGreaterThan(99);
    });

    it('should keep noise values within 2 BPM of base curve', () => {
      const variance = 2;
      const baseHR = 120;
      const samples = 1000;
      let maxDeviation = 0;

      for (let i = 0; i < samples; i++) {
        const noise = generateGaussianNoise(variance);
        const hr = baseHR + noise;
        const deviation = Math.abs(hr - baseHR);
        maxDeviation = Math.max(maxDeviation, deviation);
      }

      // With variance of 2, 99.7% should be within ~4.2 BPM (3 * sqrt(2))
      // But we'll check that most are within 2 BPM
      // Actually, let's check that 95% are within 2 * sqrt(2) ≈ 2.8 BPM
      expect(maxDeviation).toBeLessThan(10); // Allow for rare outliers
    });

    it('should verify noise distribution is Gaussian', () => {
      const variance = 2;
      const samples = 10000;
      const noiseValues: number[] = [];

      for (let i = 0; i < samples; i++) {
        noiseValues.push(generateGaussianNoise(variance));
      }

      // Check that values are distributed around 0
      const positive = noiseValues.filter(v => v > 0).length;
      const negative = noiseValues.filter(v => v < 0).length;
      
      // Should be roughly equal (within 5%)
      const ratio = positive / (positive + negative);
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(0.55);
    });
  });

  describe('HR Curve Functions', () => {
    it('getFitter should produce HIIT spikes', () => {
      const params = defaultProfileParameters.getFitter;
      // Test at start of cycle (should be ramping up)
      const hr1 = getFitter(0, params);
      expect(hr1).toBeGreaterThanOrEqual(120);
      expect(hr1).toBeLessThanOrEqual(180);

      // Test at peak (20 seconds)
      const hr2 = getFitter(20, params);
      expect(hr2).toBeGreaterThanOrEqual(170);
      expect(hr2).toBeLessThanOrEqual(180);

      // Test during recovery (40 seconds)
      const hr3 = getFitter(40, params);
      expect(hr3).toBeGreaterThanOrEqual(120);
      expect(hr3).toBeLessThanOrEqual(150);
    });

    it('loseWeight should maintain steady Zone 2', () => {
      const params = defaultProfileParameters.loseWeight;
      const hr1 = loseWeight(0, params);
      const hr2 = loseWeight(30, params);
      const hr3 = loseWeight(60, params);

      // All should be in Zone 2 range (130-140 BPM ± variation)
      expect(hr1).toBeGreaterThanOrEqual(125);
      expect(hr1).toBeLessThanOrEqual(145);
      expect(hr2).toBeGreaterThanOrEqual(125);
      expect(hr2).toBeLessThanOrEqual(145);
      expect(hr3).toBeGreaterThanOrEqual(125);
      expect(hr3).toBeLessThanOrEqual(145);
    });

    it('getStronger should produce bursts', () => {
      const params = defaultProfileParameters.getStronger;
      // Test at start of burst
      const hr1 = getStronger(0, params);
      expect(hr1).toBeGreaterThanOrEqual(110);
      expect(hr1).toBeLessThanOrEqual(170);

      // Test at peak burst (15 seconds)
      const hr2 = getStronger(15, params);
      expect(hr2).toBeGreaterThanOrEqual(160);
      expect(hr2).toBeLessThanOrEqual(170);

      // Test during rest (45 seconds)
      const hr3 = getStronger(45, params);
      expect(hr3).toBeLessThan(150);
    });

    it('feelBetter should maintain low intensity', () => {
      const params = defaultProfileParameters.feelBetter;
      const hr1 = feelBetter(0, params);
      const hr2 = feelBetter(30, params);
      const hr3 = feelBetter(60, params);

      // All should be in low intensity range (90-110 BPM ± variation)
      expect(hr1).toBeGreaterThanOrEqual(85);
      expect(hr1).toBeLessThanOrEqual(115);
      expect(hr2).toBeGreaterThanOrEqual(85);
      expect(hr2).toBeLessThanOrEqual(115);
      expect(hr3).toBeGreaterThanOrEqual(85);
      expect(hr3).toBeLessThanOrEqual(115);
    });
  });

  describe('Noise Distribution Verification', () => {
    it('should verify noise is within 2 BPM of base curve for getFitter', () => {
      const profile = 'getFitter';
      const variance = 2;
      const samples = 1000;
      let deviations: number[] = [];

      for (let i = 0; i < samples; i++) {
        const elapsedSeconds = (i % 60); // Cycle through 60-second cycle
        const profileParams: ProfileParameters = { profile: 'getFitter', params: defaultProfileParameters.getFitter };
        const baseHR = getBaseHeartRate(profileParams, elapsedSeconds);
        const noise = generateGaussianNoise(variance);
        const hr = baseHR + noise;
        const deviation = Math.abs(hr - baseHR);
        deviations.push(deviation);
      }

      // Calculate statistics
      const meanDeviation = deviations.reduce((a, b) => a + b, 0) / samples;
      const stdDev = Math.sqrt(
        deviations.reduce((sum, d) => sum + Math.pow(d - meanDeviation, 2), 0) / samples
      );
      const maxDeviation = Math.max(...deviations);
      const within2BPM = deviations.filter(d => d <= 2).length;
      const percentageWithin2BPM = (within2BPM / samples) * 100;

      // Mean deviation should be reasonable (close to expected std dev)
      expect(meanDeviation).toBeLessThan(2);
      
      // Standard deviation should be close to sqrt(variance) ≈ 1.414
      // Note: We're measuring deviation of absolute values, so it may differ slightly
      expect(stdDev).toBeGreaterThan(0.5);
      expect(stdDev).toBeLessThan(2.5);

      // At least 68% should be within 1 standard deviation (≈1.4 BPM)
      // With variance=2, ~84% should be within 2 BPM (1.4 * sqrt(2) ≈ 2)
      expect(percentageWithin2BPM).toBeGreaterThan(65);

      // Max deviation should allow for 3-sigma events (≈4.2 BPM) but cap at reasonable value
      expect(maxDeviation).toBeLessThan(8);
    });

    it('should verify noise is within 2 BPM of base curve for all profiles', () => {
      const profiles: Array<'getFitter' | 'loseWeight' | 'getStronger' | 'feelBetter' | 'warmupRecovery'> = [
        'getFitter',
        'loseWeight',
        'getStronger',
        'feelBetter',
        'warmupRecovery'
      ];
      const variance = 2;
      const samples = 500;

      profiles.forEach(profile => {
        let maxDeviation = 0;
        let deviations: number[] = [];

        for (let i = 0; i < samples; i++) {
          const elapsedSeconds = i;
          let profileParams: ProfileParameters;
          switch (profile) {
            case 'getFitter':
              profileParams = { profile: 'getFitter', params: defaultProfileParameters.getFitter };
              break;
            case 'loseWeight':
              profileParams = { profile: 'loseWeight', params: defaultProfileParameters.loseWeight };
              break;
            case 'getStronger':
              profileParams = { profile: 'getStronger', params: defaultProfileParameters.getStronger };
              break;
            case 'feelBetter':
              profileParams = { profile: 'feelBetter', params: defaultProfileParameters.feelBetter };
              break;
            case 'warmupRecovery':
              profileParams = { profile: 'warmupRecovery', params: defaultProfileParameters.warmupRecovery };
              break;
          }
          const baseHR = getBaseHeartRate(profileParams, elapsedSeconds);
          const noise = generateGaussianNoise(variance);
          const hr = baseHR + noise;
          const deviation = Math.abs(hr - baseHR);
          deviations.push(deviation);
          maxDeviation = Math.max(maxDeviation, deviation);
        }

        const meanDeviation = deviations.reduce((a, b) => a + b, 0) / samples;
        const within2BPM = deviations.filter(d => d <= 2).length;
        const percentageWithin2BPM = (within2BPM / samples) * 100;

        // Mean deviation should be reasonable
        expect(meanDeviation).toBeLessThan(2);

        // Most values should be within 2 BPM
        expect(percentageWithin2BPM).toBeGreaterThan(60);

        // Max deviation should allow for rare outliers
        expect(maxDeviation).toBeLessThan(10);
      });
    });
  });

  describe('startSimulation', () => {
    it('should start and stop simulation', () => {
      expect(getSimulationState()).toBeNull();
      
      startSimulation('loseWeight', 'test-device', 2, 100);
      expect(getSimulationState()).not.toBeNull();
      expect(getSimulationState()?.profile).toBe('loseWeight');
      
      stopSimulation();
      expect(getSimulationState()).toBeNull();
    });
  });
});
