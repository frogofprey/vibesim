import React, { useState } from 'react';
import Dashboard from './components/Dashboard';
import DebugConsole from './components/DebugConsole';
import { useHeartRate } from './hooks/useHeartRate';

const App: React.FC = () => {
  const [showDebug, setShowDebug] = useState(true);
  
  const { 
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
  } = useHeartRate();

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col relative overflow-hidden">
      
      {/* Background Gradients/Mesh */}
      <div className="fixed inset-0 pointer-events-none z-0">
         <div className="absolute top-[-20%] left-[-20%] w-[50%] h-[50%] bg-tactical-red/5 rounded-full blur-[120px]"></div>
         <div className="absolute bottom-[-20%] right-[-20%] w-[50%] h-[50%] bg-tactical-orange/5 rounded-full blur-[120px]"></div>
      </div>

      <main className="flex-1 flex flex-col p-4 md:p-8 z-10 pb-20">
        <Dashboard 
          bpm={bpm}
          history={history}
          status={status}
          deviceName={deviceName}
          onConnect={connect}
          onDisconnect={disconnect}
          showDebug={showDebug}
          onToggleDebug={() => setShowDebug(!showDebug)}
          wsStatus={wsStatus}
          wsPort={wsPort}
          onToggleWs={toggleWebSocket}
          isSimulation={isSimulation}
          startSimulation={startSimulation}
          noiseAmplitude={noiseAmplitude}
          setNoiseAmplitude={setNoiseAmplitude}
        />
      </main>

      {showDebug && (
        <DebugConsole 
          logs={logs} 
          onClear={clearLogs}
        />
      )}
    </div>
  );
};

export default App;