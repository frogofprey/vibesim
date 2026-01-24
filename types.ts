export enum ConnectionStatus {
  DISCONNECTED = 'Disconnected',
  CONNECTING = 'Connecting',
  CONNECTED = 'Connected',
  ERROR = 'Error',
}

export enum SimulationProfile {
  CARDIO = 'CARDIO',
  METABOLIC = 'METABOLIC',
  STRENGTH = 'STRENGTH',
  WELLNESS = 'WELLNESS',
}

export interface LogEntry {
  id: string;
  timestamp: number;
  type: 'info' | 'data' | 'error' | 'status';
  message: string;
  raw?: string; // Hex representation
}

export interface HeartRateData {
  timestamp: number;
  bpm: number;
}

export interface HeartRateState {
  status: ConnectionStatus;
  bpm: number | null;
  history: HeartRateData[];
  logs: LogEntry[];
  deviceName: string | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  clearLogs: () => void;
  // WebSocket Bridge State
  wsStatus: ConnectionStatus;
  wsPort: number;
  toggleWebSocket: (enable: boolean, port?: number) => void;
  // Simulation
  isSimulation: boolean;
  startSimulation: (profile: SimulationProfile) => void;
  noiseAmplitude: number;
  setNoiseAmplitude: (value: number) => void;
}