import { useState, useRef, useCallback, useEffect } from 'react';
import { ConnectionStatus, HeartRateState, LogEntry, HeartRateData, SimulationProfile } from '../types';
import { parseHeartRate, dataViewToHex } from '../utils/ble';
import { getSimulatedHeartRate, generateGaussianNoise } from '../utils/simulation';

// --- Web Bluetooth Type Definitions ---
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  value?: DataView;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

interface BluetoothRemoteGATTService extends EventTarget {
  getCharacteristic(characteristic: string | number): Promise<BluetoothRemoteGATTCharacteristic>;
}

interface BluetoothRemoteGATTServer {
  connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(service: string | number): Promise<BluetoothRemoteGATTService>;
}

interface BluetoothDevice extends EventTarget {
  id: string;
  name?: string;
  gatt?: BluetoothRemoteGATTServer;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

declare global {
  interface Navigator {
    bluetooth: {
      requestDevice(options?: { filters?: any[]; optionalServices?: (string | number)[]; acceptAllDevices?: boolean; }): Promise<BluetoothDevice>;
    };
  }
}
// ---------------------------------------

const HEART_RATE_SERVICE_UUID = 0x180D;
const HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID = 0x2A37;

export const useHeartRate = (): HeartRateState => {
  // BLE State
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [bpm, setBpm] = useState<number | null>(null);
  const [history, setHistory] = useState<HeartRateData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [rawDeviceId, setRawDeviceId] = useState<string | null>(null);

  // Simulation State
  const [isSimulation, setIsSimulation] = useState(false);
  const [noiseAmplitude, setNoiseAmplitudeState] = useState(2);
  
  // WebSocket State
  const [wsStatus, setWsStatus] = useState<ConnectionStatus>(ConnectionStatus.DISCONNECTED);
  const [wsPort, setWsPort] = useState<number>(8765);
  
  // Refs
  const deviceRef = useRef<BluetoothDevice | null>(null);
  const serverRef = useRef<BluetoothRemoteGATTServer | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReconnectTimer = useRef<number | null>(null);
  const simulationTimerRef = useRef<number | null>(null);
  const noiseAmplitudeRef = useRef(2); // Ref for immediate access inside interval
  
  // Logging Helper
  const addLog = useCallback((type: LogEntry['type'], message: string, raw?: string) => {
    setLogs(prev => {
      const newLog = {
        id: Math.random().toString(36).substring(7),
        timestamp: Date.now(),
        type,
        message,
        raw
      };
      // Append to end so newer logs are at the bottom. Keep last 500.
      return [...prev, newLog].slice(-500);
    });
  }, []);

  // Rolling buffer helper
  const addToHistory = useCallback((newBpm: number) => {
    setHistory(prev => {
      const now = Date.now();
      const newData = { timestamp: now, bpm: newBpm };
      // Keep last 60 seconds approximately.
      const cutoff = now - 60000;
      const filtered = prev.filter(p => p.timestamp > cutoff);
      return [...filtered, newData];
    });
  }, []);

  const setNoiseAmplitude = useCallback((value: number) => {
    setNoiseAmplitudeState(value);
    noiseAmplitudeRef.current = value;
  }, []);

  // Centralized Data Processor (Used by both BLE and Simulation)
  const processHeartRate = useCallback((currentBpm: number, rawHex: string = 'N/A') => {
    setBpm(currentBpm);
    addToHistory(currentBpm);

    // Prepare JSON payload (Standardized Format)
    const payload = JSON.stringify({
      device_id: rawDeviceId || 'UNKNOWN_DEVICE',
      date: new Date().toISOString(),
      hr: currentBpm.toString(),
      action: 'hr'
    });

    let logMessage = `BPM Update: ${currentBpm}`;

    // Forward to WebSocket if connected
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(payload);
      logMessage += ` >> WS SENT`;
    }

    // Consolidate Hex and JSON into the raw log field
    const rawDisplay = `HEX: ${rawHex}\nJSON: ${payload}`;
    
    addLog('data', logMessage, rawDisplay);
  }, [addLog, addToHistory, rawDeviceId]);

  // WebSocket Logic
  const toggleWebSocket = useCallback((enable: boolean, port: number = 8765) => {
    if (wsReconnectTimer.current) {
      clearTimeout(wsReconnectTimer.current);
      wsReconnectTimer.current = null;
    }

    if (!enable) {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsStatus(ConnectionStatus.DISCONNECTED);
      addLog('status', 'WebSocket Bridge stopped');
      return;
    }

    setWsPort(port);
    setWsStatus(ConnectionStatus.CONNECTING);
    addLog('status', `Attempting to start WS Bridge on port ${port}...`);

    try {
      // Note: Browsers cannot act as servers. We connect to a local relay/server.
      const ws = new WebSocket(`ws://localhost:${port}`);
      
      ws.onopen = () => {
        setWsStatus(ConnectionStatus.CONNECTED);
        addLog('status', `WS Bridge Established (localhost:${port})`);
      };

      ws.onclose = () => {
        setWsStatus(ConnectionStatus.DISCONNECTED);
        // Only log disconnect if we intended to be connected
        if (wsRef.current === ws) {
          addLog('error', 'WS Bridge Disconnected');
          wsRef.current = null;
        }
      };

      ws.onerror = (e) => {
        setWsStatus(ConnectionStatus.ERROR);
        addLog('error', 'WS Connection Error. Ensure a server/relay is listening.');
      };

      wsRef.current = ws;
    } catch (e: any) {
      setWsStatus(ConnectionStatus.ERROR);
      addLog('error', `WS Init Error: ${e.message}`);
    }
  }, [addLog]);

  // Handle Incoming BLE Data
  const handleCharacteristicValueChanged = useCallback((event: Event) => {
    const characteristic = event.target as BluetoothRemoteGATTCharacteristic;
    const value = characteristic.value;

    if (value) {
      const rawHex = dataViewToHex(value);
      try {
        const currentBpm = parseHeartRate(value);
        processHeartRate(currentBpm, rawHex);
      } catch (error) {
        addLog('error', 'Failed to parse heart rate data', rawHex);
        console.error(error);
      }
    }
  }, [addLog, processHeartRate]);

  const disconnect = useCallback(() => {
    // 1. Stop BLE
    if (deviceRef.current && deviceRef.current.gatt && deviceRef.current.gatt.connected) {
      try {
        deviceRef.current.gatt.disconnect();
      } catch(e) {
        console.warn('Error during disconnect:', e);
      }
    }
    
    // 2. Stop Simulation
    if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
        simulationTimerRef.current = null;
    }

    // Cleanup state
    deviceRef.current = null;
    serverRef.current = null;
    setStatus(ConnectionStatus.DISCONNECTED);
    setDeviceName(null);
    setRawDeviceId(null);
    setBpm(null);
    setIsSimulation(false);
    addLog('status', 'Disconnected/Stopped');
  }, [addLog]);

  const connect = useCallback(async () => {
    if (!navigator.bluetooth) {
      addLog('error', 'Web Bluetooth API not available in this browser.');
      return;
    }

    // Ensure clean state before starting
    disconnect();
    setIsSimulation(false);

    try {
      setStatus(ConnectionStatus.CONNECTING);
      addLog('status', 'Requesting Bluetooth Device...');

      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [HEART_RATE_SERVICE_UUID] }],
        optionalServices: [HEART_RATE_SERVICE_UUID]
      });

      deviceRef.current = device;
      
      const name = device.name || 'Unknown Device';
      const id = device.id; 
      const displayId = `${name} - ${id}`;
      
      setDeviceName(displayId);
      setRawDeviceId(id);

      addLog('status', `Device selected: ${displayId}`);

      device.addEventListener('gattserverdisconnected', () => {
        addLog('status', 'Device disconnected unexpectedly');
        disconnect();
      });

      addLog('status', 'Connecting to GATT Server...');
      if (!device.gatt) {
        throw new Error('GATT server not found on device.');
      }
      
      const server = await device.gatt.connect();
      serverRef.current = server;
      setStatus(ConnectionStatus.CONNECTED);
      addLog('status', 'Connected to GATT Server');

      addLog('status', 'Getting Heart Rate Service...');
      const service = await server.getPrimaryService(HEART_RATE_SERVICE_UUID);

      addLog('status', 'Getting Characteristic...');
      const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT_CHARACTERISTIC_UUID);

      addLog('status', 'Starting Notifications...');
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', handleCharacteristicValueChanged);

      addLog('status', 'Notifications started. Waiting for data...');

    } catch (error: any) {
      console.error(error);
      setStatus(ConnectionStatus.ERROR);
      
      let errorMessage = error.message || 'Unknown Error';
      
      if (errorMessage.includes('User cancelled')) {
        errorMessage = 'Device selection cancelled.';
        setStatus(ConnectionStatus.DISCONNECTED);
      } else if (errorMessage.includes('Connection attempt failed')) {
        errorMessage = 'Connection failed. Device may be busy, out of range, or battery low.';
      }

      addLog('error', `BLE Error: ${errorMessage}`);
    }
  }, [addLog, disconnect, handleCharacteristicValueChanged]);

  const startSimulation = useCallback((profile: SimulationProfile) => {
    // Ensure clean state
    disconnect();
    
    // Set Sim State
    setIsSimulation(true);
    const startTime = Date.now();
    
    setStatus(ConnectionStatus.CONNECTED);
    setDeviceName(`SIMULATION - ${profile}`);
    setRawDeviceId('SIM_VIRTUAL_DEVICE');
    addLog('status', `Starting Simulation Profile: ${profile}`);

    // Update once immediately
    const initialBase = getSimulatedHeartRate(profile, 0);
    const initialNoise = generateGaussianNoise(0, noiseAmplitudeRef.current);
    processHeartRate(Math.round(initialBase + initialNoise), 'SIMULATED');

    // Start Loop (500ms for 2Hz)
    simulationTimerRef.current = window.setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        const baseBpm = getSimulatedHeartRate(profile, elapsedSec);
        
        // Apply Gaussian noise
        const noise = generateGaussianNoise(0, noiseAmplitudeRef.current);
        const noisyBpm = Math.max(30, Math.min(220, baseBpm + noise)); // Clamp safety limits

        processHeartRate(Math.round(noisyBpm), 'SIMULATED');
    }, 500);

  }, [disconnect, addLog, processHeartRate]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (wsReconnectTimer.current) {
        clearTimeout(wsReconnectTimer.current);
      }
      if (simulationTimerRef.current) {
        clearInterval(simulationTimerRef.current);
      }
    };
  }, []);

  return {
    status,
    bpm,
    history,
    logs,
    deviceName,
    connect,
    disconnect,
    clearLogs,
    wsStatus,
    wsPort,
    toggleWebSocket,
    isSimulation,
    startSimulation,
    noiseAmplitude,
    setNoiseAmplitude
  };
};