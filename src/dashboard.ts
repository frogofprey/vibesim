import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { 
  startSimulation, 
  stopSimulation, 
  updateSimulationProfile, 
  updateSimulationVariance,
  updateProfileParameters,
  Profile,
  ProfileParameters,
  defaultProfileParameters,
  GetFitterParams,
  LoseWeightParams,
  GetStrongerParams,
  FeelBetterParams
} from './simulator';
import { startBLE, stopBLE, getCurrentDeviceId, startHRMScan, startBLEWithDeviceId, isValidBleDeviceId } from './ble-controller';
import { startReplay, stopReplay, updateReplayDataRate, updateReplayNoiseVariance, skipAheadOneMinute, ReplayProfile } from './replay-controller';
// Start WebSocket server (but don't capture its logs immediately)
import './server';
import { setScanRequestHandler, setConnectRequestHandler, WS_SERVER_PORT } from './server';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

const PORT = 3000;

// Serve static files (HTML, CSS, JS)
const publicPath = path.join(__dirname, '..', 'public');
app.use(express.static(publicPath));

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Logging system
let logMessages: string[] = [];
const MAX_LOG_MESSAGES = 1000;

function addLog(message: string): void {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}`;
  logMessages.push(logEntry);
  
  // Keep only the last MAX_LOG_MESSAGES
  if (logMessages.length > MAX_LOG_MESSAGES) {
    logMessages = logMessages.slice(-MAX_LOG_MESSAGES);
  }
  
  // Broadcast to all connected clients
  io.emit('log', logEntry);
  // Use originalLog to avoid recursion
  originalLog(logEntry);
}

// Override console methods to capture logs
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

console.log = (...args: any[]) => {
  originalLog(...args);
  addLog(args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' '));
};

console.error = (...args: any[]) => {
  originalError(...args);
  addLog(`ERROR: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')}`);
};

console.warn = (...args: any[]) => {
  originalWarn(...args);
  addLog(`WARN: ${args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')}`);
};

// Track current state
let currentMode: 'Live' | 'Sim' | 'Replay' = 'Sim';
let isRunning = false;
let currentProfile: Profile = 'loseWeight';
let currentNoiseVariance: number = 2; // Default 2 BPM
let replayProfile: ReplayProfile = 'profile1'; // Default replay profile
let replayDataRate: number = 1.0; // Default 1Hz, max 2Hz
let replayEnableInterpolation: boolean = true; // Default enabled
let isScanning = false; // HRM discovery scan (no stream active)

// Track profile parameters for each profile
let profileParameters: {
  getFitter: GetFitterParams;
  loseWeight: LoseWeightParams;
  getStronger: GetStrongerParams;
  feelBetter: FeelBetterParams;
} = {
  getFitter: { ...defaultProfileParameters.getFitter },
  loseWeight: { ...defaultProfileParameters.loseWeight },
  getStronger: { ...defaultProfileParameters.getStronger },
  feelBetter: { ...defaultProfileParameters.feelBetter }
};

// Build full state object for Socket.io (single source of truth)
function getFullState() {
  return {
    mode: currentMode,
    isRunning,
    profile: currentProfile,
    noiseVariance: currentNoiseVariance,
    profileParameters: profileParameters,
    replayProfile: replayProfile,
    replayDataRate: replayDataRate,
    replayEnableInterpolation: replayEnableInterpolation,
    isScanning,
    wsServerPort: WS_SERVER_PORT
  };
}

// Get device ID based on current mode
function getDeviceId(): string {
  if (currentMode === 'Live') {
    const bleDeviceId = getCurrentDeviceId();
    // Return actual BLE device ID or a placeholder
    return bleDeviceId || 'ble-device-pending';
  } else if (currentMode === 'Replay') {
    // Replay mode: use replay-profile format
    return `replay-${replayProfile}`;
  } else {
    // Sim mode: use profile-based device ID
    return `simulator-${currentProfile}`;
  }
}

// Socket.io connection handling
io.on('connection', (socket) => {
  addLog('Dashboard client connected');
  
  // Send current state to new client
  socket.emit('state', getFullState());
  
  // Send all existing log messages
  socket.emit('logHistory', logMessages);
  
  // Handle mode change
  socket.on('setMode', (mode: 'Live' | 'Sim' | 'Replay') => {
    if (isRunning) {
      socket.emit('error', 'Cannot change mode while running. Please stop first.');
      return;
    }
    const oldMode = currentMode;
    currentMode = mode;
    addLog(`Mode changed from ${oldMode} to ${mode}`);
    addLog(`Device ID will be: ${getDeviceId()}`);
    io.emit('state', getFullState());
  });
  
  // Handle replay profile change
  socket.on('setReplayProfile', (profile: ReplayProfile) => {
    if (isRunning && currentMode === 'Replay') {
      socket.emit('error', 'Cannot change replay profile while running. Please stop first.');
      return;
    }
    replayProfile = profile;
    addLog(`Replay profile changed to: ${profile}`);
    io.emit('state', getFullState());
  });
  
  // Handle replay data rate change
  socket.on('setReplayDataRate', (rate: number) => {
    if (rate < 0.1 || rate > 2.0) {
      socket.emit('error', 'Data rate must be between 0.1 and 2.0 Hz');
      return;
    }
    
    const oldRate = replayDataRate;
    replayDataRate = rate;
    
    // Update replay if running
    if (isRunning && currentMode === 'Replay') {
      try {
        updateReplayDataRate(rate);
        addLog(`Replay data rate changed from ${oldRate} to ${rate} Hz while running`);
      } catch (error: any) {
        replayDataRate = oldRate; // Revert on error
        socket.emit('error', `Failed to change data rate: ${error.message}`);
        return;
      }
    } else {
      addLog(`Replay data rate changed to: ${rate} Hz`);
    }
    
    io.emit('state', getFullState());
  });
  
  // Handle skip ahead 1 minute
  socket.on('skipReplayAhead', () => {
    if (!isRunning || currentMode !== 'Replay') {
      socket.emit('error', 'Replay is not running');
      return;
    }
    
    try {
      skipAheadOneMinute();
      addLog('Skipped ahead 1 minute in replay data');
    } catch (error: any) {
      socket.emit('error', `Failed to skip ahead: ${error.message}`);
    }
  });
  
  // Handle interpolation toggle
  socket.on('setReplayInterpolation', (enabled: boolean) => {
    if (isRunning && currentMode === 'Replay') {
      socket.emit('error', 'Cannot change interpolation setting while replay is running. Please stop first.');
      return;
    }
    
    replayEnableInterpolation = enabled;
    addLog(`Replay interpolation ${enabled ? 'enabled' : 'disabled'}`);
    io.emit('state', getFullState());
  });

  // Handle HRM scan (discovery only; not allowed when stream active)
  socket.on('startHRMScan', () => {
    if (isRunning) {
      socket.emit('error', 'Cannot scan while a stream is active (Live/Sim/Replay). Stop first.');
      return;
    }
    if (isScanning) {
      socket.emit('error', 'HRM scan already in progress.');
      return;
    }
    isScanning = true;
    io.emit('state', getFullState());
    addLog('Starting HRM scan (60s)...');
    startHRMScan({
      durationMs: 60000,
      onDevice(device) {
        addLog(`Found HRM: ${device.name} (${device.deviceId})`);
        io.emit('scanDevice', device);
      },
      onComplete(devices) {
        isScanning = false;
        io.emit('scanComplete', { devices });
        addLog(`HRM scan complete: ${devices.length} device(s) found.`);
        io.emit('state', getFullState());
      }
    });
  });
  
  // Handle profile change
  socket.on('setProfile', (profile: Profile) => {
    // Update currentProfile first so getDeviceId() returns the correct value
    const oldProfile = currentProfile;
    currentProfile = profile;
    // Allow profile changes while running in Sim mode
    if (isRunning && currentMode === 'Sim') {
      try {
        const newDeviceId = getDeviceId(); // Get updated device ID based on new profile
        let profileParams: ProfileParameters;
        switch (currentProfile) {
          case 'getFitter':
            profileParams = { profile: 'getFitter', params: profileParameters.getFitter };
            break;
          case 'loseWeight':
            profileParams = { profile: 'loseWeight', params: profileParameters.loseWeight };
            break;
          case 'getStronger':
            profileParams = { profile: 'getStronger', params: profileParameters.getStronger };
            break;
          case 'feelBetter':
            profileParams = { profile: 'feelBetter', params: profileParameters.feelBetter };
            break;
        }
        updateSimulationProfile(profile, newDeviceId, profileParams);
        addLog(`Profile changed from ${oldProfile} to ${profile} while running`);
        addLog(`Device ID updated to: ${newDeviceId}`);
        io.emit('state', getFullState());
      } catch (error: any) {
        // Revert profile on error
        currentProfile = oldProfile;
        socket.emit('error', `Failed to change profile: ${error.message}`);
      }
    } else if (isRunning && currentMode === 'Live') {
      // Revert profile on error
      currentProfile = oldProfile;
      socket.emit('error', 'Cannot change profile in Live mode while running.');
      return;
    } else {
      addLog(`Profile changed from ${oldProfile} to ${profile}`);
      io.emit('state', getFullState());
    }
  });
  
  // Handle profile parameters change
  socket.on('setProfileParameters', (params: ProfileParameters) => {
    try {
      // Validate profile matches current profile
      if (params.profile !== currentProfile) {
        socket.emit('error', `Cannot update parameters for ${params.profile} while ${currentProfile} is selected`);
        return;
      }
      
      // Update stored parameters
      switch (params.profile) {
        case 'getFitter':
          profileParameters.getFitter = params.params;
          break;
        case 'loseWeight':
          profileParameters.loseWeight = params.params;
          break;
        case 'getStronger':
          profileParameters.getStronger = params.params;
          break;
        case 'feelBetter':
          profileParameters.feelBetter = params.params;
          break;
      }
      
      // Update simulation if running
      if (isRunning && currentMode === 'Sim') {
        updateProfileParameters(params);
        addLog(`Profile parameters updated for ${params.profile} while running`);
      } else {
        addLog(`Profile parameters updated for ${params.profile}`);
      }
      
      io.emit('state', getFullState());
    } catch (error: any) {
      socket.emit('error', `Failed to update parameters: ${error.message}`);
    }
  });
  
  // Handle noise variance change
  socket.on('setNoiseVariance', (variance: number) => {
    if (isNaN(variance) || variance < 0 || variance > 10) {
      socket.emit('error', 'Noise variance must be between 0 and 10 BPM');
      return;
    }
    
    currentNoiseVariance = variance;
    
    // Update simulation if running
    if (isRunning && currentMode === 'Sim') {
      try {
        updateSimulationVariance(variance);
        addLog(`Noise variance changed to: ${variance} BPM while running`);
      } catch (error: any) {
        socket.emit('error', `Failed to change variance: ${error.message}`);
      }
    } else {
      addLog(`Noise variance changed to: ${variance} BPM`);
    }
    
    io.emit('state', getFullState());
  });
  
  // Handle start/stop
  socket.on('start', () => {
    if (isRunning) {
      socket.emit('error', 'Already running');
      return;
    }
    
    isRunning = true;
    addLog(`Starting in ${currentMode} mode...`);
    
    if (currentMode === 'Sim') {
      const deviceId = getDeviceId();
      let profileParams: ProfileParameters;
      switch (currentProfile) {
        case 'getFitter':
          profileParams = { profile: 'getFitter', params: profileParameters.getFitter };
          break;
        case 'loseWeight':
          profileParams = { profile: 'loseWeight', params: profileParameters.loseWeight };
          break;
        case 'getStronger':
          profileParams = { profile: 'getStronger', params: profileParameters.getStronger };
          break;
        case 'feelBetter':
          profileParams = { profile: 'feelBetter', params: profileParameters.feelBetter };
          break;
      }
      startSimulation(currentProfile, deviceId, currentNoiseVariance, 1000, profileParams);
      addLog(`Simulation started with profile: ${currentProfile}`);
      addLog(`Noise variance: ${currentNoiseVariance} BPM`);
      addLog(`Device ID: ${deviceId}`);
    } else if (currentMode === 'Replay') {
      // Replay mode - start replay
      const deviceId = getDeviceId();
      addLog(`Starting replay for ${replayProfile}...`);
      addLog(`Data rate: ${replayDataRate} Hz, Noise variance: ${currentNoiseVariance} BPM, Interpolation: ${replayEnableInterpolation ? 'enabled' : 'disabled'}`);
      startReplay(replayProfile, replayDataRate, currentNoiseVariance, replayEnableInterpolation);
      addLog(`Replay started. Device ID: ${deviceId}`);
    } else {
      // Live mode - start BLE scanner
      addLog('Starting BLE scanner...');
      startBLE();
      addLog('BLE scanner started. Searching for HRM devices...');
    }
    
    io.emit('state', getFullState());
  });
  
  socket.on('stop', () => {
    if (!isRunning) {
      socket.emit('error', 'Not running');
      return;
    }
    
    isRunning = false;
    addLog('Stopping...');
    
    if (currentMode === 'Sim') {
      stopSimulation();
      addLog('Simulation stopped');
    } else if (currentMode === 'Replay') {
      stopReplay();
      addLog('Replay stopped');
    } else {
      // Live mode - stop BLE scanner
      stopBLE();
      addLog('BLE scanner stopped');
    }
    
    io.emit('state', getFullState());
  });
  
  socket.on('disconnect', () => {
    addLog('Dashboard client disconnected');
  });
});

// Allow remote WS client (port 8080) to trigger HRM scan by sending text "scan"
setScanRequestHandler((reply) => {
  if (isRunning) {
    reply({ action: 'scan_rejected', error: 'Cannot scan while a stream is active (Live/Sim/Replay). Stop first.' });
    return;
  }
  if (isScanning) {
    reply({ action: 'scan_rejected', error: 'HRM scan already in progress.' });
    return;
  }
  isScanning = true;
  io.emit('state', getFullState());
  addLog('Starting HRM scan (60s)...');
  reply({ action: 'scan_started' });
  startHRMScan({
    durationMs: 60000,
    onDevice(device) {
      addLog(`Found HRM: ${device.name} (${device.deviceId})`);
      io.emit('scanDevice', device);
    },
    onComplete(devices) {
      isScanning = false;
      io.emit('scanComplete', { devices });
      addLog(`HRM scan complete: ${devices.length} device(s) found.`);
      io.emit('state', getFullState());
    }
  });
});

// Allow remote WS client to start live session by sending "connect:<deviceId>" (e.g. connect:A0:9E:1A:DD:2D:5F)
setConnectRequestHandler((deviceId, reply) => {
  if (isRunning) {
    reply({ action: 'connect_rejected', error: 'session_already_active', message: 'A stream is already active. Stop first.' });
    return;
  }
  if (isScanning) {
    reply({ action: 'connect_rejected', error: 'scan_in_progress', message: 'HRM scan in progress. Wait for it to finish.' });
    return;
  }
  if (!isValidBleDeviceId(deviceId)) {
    reply({ action: 'connect_rejected', error: 'invalid_device_id', message: 'Invalid device ID; expected BLE address (e.g. A0:9E:1A:DD:2D:5F).' });
    return;
  }
  currentMode = 'Live';
  isRunning = true;
  io.emit('state', getFullState());
  addLog(`Starting live session for device ${deviceId}...`);
  startBLEWithDeviceId(deviceId, {
    onSuccess() {
      reply({ action: 'connect_started', deviceId });
      io.emit('state', getFullState());
      addLog(`Live session started for ${deviceId}`);
    },
    onError(err) {
      isRunning = false;
      io.emit('state', getFullState());
      const messages: Record<string, string> = {
        session_already_active: 'A stream is already active.',
        scan_in_progress: 'HRM scan in progress.',
        invalid_device_id: 'Invalid device ID format.',
        device_not_found: 'Device not found within 30s.',
        connection_failed: 'Connection or subscribe failed.'
      };
      reply({ action: 'connect_failed', error: err, message: messages[err] || err });
      addLog(`Connect failed for ${deviceId}: ${err}`);
    }
  });
});

// Start HTTP server
httpServer.listen(PORT, () => {
  originalLog(`\n========================================`);
  originalLog(`Dashboard server started on http://localhost:${PORT}`);
  originalLog(`Open your browser to http://localhost:${PORT}`);
  originalLog(`========================================\n`);
  addLog(`Dashboard server started on http://localhost:${PORT}`);
});

// Handle graceful shutdown
process.on('SIGINT', () => {
  addLog('Shutting down dashboard server...');
  if (isRunning) {
    if (currentMode === 'Sim') {
      stopSimulation();
    } else if (currentMode === 'Replay') {
      stopReplay();
    } else {
      stopBLE();
    }
  }
  httpServer.close(() => {
    process.exit(0);
  });
});

export { addLog, io };
