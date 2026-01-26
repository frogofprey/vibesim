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
import { startBLE, stopBLE, getCurrentDeviceId } from './ble-controller';
import { startReplay, stopReplay, ReplayProfile } from './replay-controller';
// Start WebSocket server (but don't capture its logs immediately)
import './server';

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
  socket.emit('state', {
    mode: currentMode,
    isRunning,
    profile: currentProfile,
    noiseVariance: currentNoiseVariance,
  });
  
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
    io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
  });
  
  // Handle replay profile change
  socket.on('setReplayProfile', (profile: ReplayProfile) => {
    if (isRunning && currentMode === 'Replay') {
      socket.emit('error', 'Cannot change replay profile while running. Please stop first.');
      return;
    }
    replayProfile = profile;
    addLog(`Replay profile changed to: ${profile}`);
    io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
        io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
      io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
      
      io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
    
    io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
      startReplay(replayProfile);
      addLog(`Replay started. Device ID: ${deviceId}`);
    } else {
      // Live mode - start BLE scanner
      addLog('Starting BLE scanner...');
      startBLE();
      addLog('BLE scanner started. Searching for HRM devices...');
    }
    
    io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
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
    
    io.emit('state', { mode: currentMode, isRunning, profile: currentProfile, noiseVariance: currentNoiseVariance, profileParameters: profileParameters, replayProfile: replayProfile });
  });
  
  socket.on('disconnect', () => {
    addLog('Dashboard client disconnected');
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
