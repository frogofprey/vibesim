import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';
import { Heart, Activity, Zap, Terminal, Radio, Settings, X, Wifi, Play, Cpu, Volume2 } from 'lucide-react';
import { HeartRateData, ConnectionStatus, SimulationProfile } from '../types';

interface DashboardProps {
  bpm: number | null;
  history: HeartRateData[];
  status: ConnectionStatus;
  deviceName: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
  showDebug: boolean;
  onToggleDebug: () => void;
  // WS Props
  wsStatus: ConnectionStatus;
  wsPort: number;
  onToggleWs: (enable: boolean, port?: number) => void;
  // Simulation Props
  isSimulation: boolean;
  startSimulation: (profile: SimulationProfile) => void;
  noiseAmplitude: number;
  setNoiseAmplitude: (val: number) => void;
}

const Dashboard: React.FC<DashboardProps> = ({ 
  bpm, 
  history, 
  status, 
  deviceName, 
  onConnect, 
  onDisconnect,
  showDebug,
  onToggleDebug,
  wsStatus,
  wsPort,
  onToggleWs,
  isSimulation,
  startSimulation,
  noiseAmplitude,
  setNoiseAmplitude
}) => {
  const [showBridgeModal, setShowBridgeModal] = useState(false);
  const [showSimModal, setShowSimModal] = useState(false);
  const [tempPort, setTempPort] = useState(wsPort.toString());

  const chartData = useMemo(() => {
    return history.map(h => ({
      ...h,
      timeStr: new Date(h.timestamp).toLocaleTimeString([], { second: '2-digit', minute: '2-digit' })
    }));
  }, [history]);

  const isConnected = status === ConnectionStatus.CONNECTED;
  const isConnecting = status === ConnectionStatus.CONNECTING;
  const isWsConnected = wsStatus === ConnectionStatus.CONNECTED;

  // Determine pulse animation speed based on BPM
  const animationDuration = bpm ? 60 / bpm : 0;
  
  const simulationOptions = [
    { 
      id: SimulationProfile.CARDIO, 
      label: 'Get Fitter', 
      sub: 'Cardio', 
      desc: 'Warmup → Intervals (130-150 BPM)',
      color: 'border-green-500/50 hover:bg-green-500/10 text-green-400'
    },
    { 
      id: SimulationProfile.METABOLIC, 
      label: 'Lose Weight', 
      sub: 'Metabolic', 
      desc: 'Fat-Burn Pocket (Steady 112 BPM)',
      color: 'border-yellow-500/50 hover:bg-yellow-500/10 text-yellow-400'
    },
    { 
      id: SimulationProfile.STRENGTH, 
      label: 'Get Stronger', 
      sub: 'Strength', 
      desc: 'Sawtooth: Set (135) / Rest (85)',
      color: 'border-red-500/50 hover:bg-red-500/10 text-red-400'
    },
    { 
      id: SimulationProfile.WELLNESS, 
      label: 'Feel Better', 
      sub: 'Wellness', 
      desc: 'Parasympathetic Drift (80 → 65 BPM)',
      color: 'border-blue-500/50 hover:bg-blue-500/10 text-blue-400'
    },
  ];

  return (
    <div className="flex flex-col gap-6 w-full max-w-4xl mx-auto relative">
      {/* Header / Status Bar */}
      <div className="flex items-center justify-between border-b-2 border-tactical-red/30 pb-4">
        <div className="flex items-center gap-3">
           <div className={`p-2 border border-tactical-red/50 bg-tactical-red/10 rounded-sm`}>
              <Activity className="text-tactical-red w-6 h-6" />
           </div>
           <div>
             <h1 className="text-2xl font-tactical uppercase tracking-wider text-white">Tactical Pulse</h1>
             <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
               <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`}></span>
               <span>{status.toUpperCase()}</span>
               
               {/* WS Indicator */}
               <span className="mx-1 text-gray-700">|</span>
               <Wifi size={10} className={isWsConnected ? 'text-blue-400' : 'text-gray-600'} />
               <span className={isWsConnected ? 'text-blue-400' : 'text-gray-600'}>
                 BRIDGE: {wsStatus.toUpperCase()}
               </span>

               {deviceName && <span className="text-tactical-orange ml-2">// {deviceName}</span>}
             </div>
           </div>
        </div>

        <div className="flex gap-2 sm:gap-4">
          <button
            onClick={() => setShowBridgeModal(true)}
            className={`
              flex items-center gap-2 px-3 sm:px-4 py-3 font-mono text-xs uppercase tracking-wider border transition-colors
              ${isWsConnected
                ? 'border-blue-500 text-blue-500 bg-blue-500/10' 
                : 'border-white/20 text-gray-400 hover:border-white/40'
              }
            `}
            title="Configure WebSocket Bridge"
          >
            <Radio size={14} />
            <span className="hidden sm:inline">Bridge</span>
          </button>

          <button
            onClick={onToggleDebug}
            className={`
              flex items-center gap-2 px-3 sm:px-4 py-3 font-mono text-xs uppercase tracking-wider border transition-colors
              ${showDebug 
                ? 'border-tactical-orange text-tactical-orange bg-tactical-orange/10' 
                : 'border-white/20 text-gray-400 hover:border-white/40'
              }
            `}
            title="Toggle Debug Console"
          >
            <Terminal size={14} />
            <span className="hidden sm:inline">Debug</span>
          </button>

          {/* Connection Controls */}
          <div className="flex items-center gap-4">
            {isConnected ? (
              isSimulation ? (
                <>
                   {/* Noise Control for Simulation */}
                   <div className="hidden sm:flex flex-col items-end mr-2">
                      <div className="flex items-center gap-1 text-[10px] font-mono text-gray-400 uppercase tracking-wider mb-1">
                        <Volume2 size={10} />
                        <span>Sim Noise (σ)</span>
                      </div>
                      <div className="flex items-center gap-2">
                          <input 
                              type="range" 
                              min="0" 
                              max="10" 
                              step="0.5" 
                              value={noiseAmplitude} 
                              onChange={(e) => setNoiseAmplitude(parseFloat(e.target.value))}
                              className="w-24 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-green-500"
                              title="Gaussian Noise Amplitude"
                          />
                          <span className="font-mono text-xs text-green-400 w-8 text-right">{noiseAmplitude}</span>
                      </div>
                  </div>

                  <button
                    onClick={onDisconnect}
                    className="font-mono uppercase text-sm font-bold tracking-widest px-4 sm:px-6 py-3 border-2 transition-all duration-200 border-green-500 text-green-500 hover:bg-green-500 hover:text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]"
                  >
                    STOP SIM
                  </button>
                </>
              ) : (
                <button
                  onClick={onDisconnect}
                  className="font-mono uppercase text-sm font-bold tracking-widest px-4 sm:px-6 py-3 border-2 transition-all duration-200 border-tactical-red text-tactical-red hover:bg-tactical-red hover:text-white"
                >
                  UNLINK
                </button>
              )
            ) : (
              <div className="flex">
                 <button
                   onClick={() => setShowSimModal(true)}
                   className="font-mono uppercase text-sm font-bold tracking-widest px-4 py-3 border-2 border-r-0 border-purple-500 text-purple-500 hover:bg-purple-500 hover:text-white transition-all duration-200 flex items-center gap-2"
                   title="Simulate Data"
                   disabled={isConnecting}
                 >
                   <Cpu size={16} />
                   <span className="hidden sm:inline">SIM</span>
                 </button>
                 <button
                  onClick={onConnect}
                  disabled={isConnecting}
                  className={`
                    font-mono uppercase text-sm font-bold tracking-widest px-4 sm:px-6 py-3 border-2 transition-all duration-200
                    border-green-500 text-green-500 hover:bg-green-500 hover:text-black shadow-[0_0_15px_rgba(34,197,94,0.3)]
                    ${isConnecting ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  {isConnecting ? 'INIT...' : 'LINK'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Metric Display */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Large BPM Display */}
        <div className="relative bg-tactical-panel border border-white/10 p-8 flex flex-col items-center justify-center min-h-[300px] overflow-hidden group">
          
          {/* Decorative Grid Background */}
          <div className="absolute inset-0 opacity-10" 
               style={{ 
                 backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.1) 1px, transparent 1px)', 
                 backgroundSize: '20px 20px' 
               }}>
          </div>
          
          {/* Corner accents */}
          <div className="absolute top-0 left-0 w-4 h-4 border-l-2 border-t-2 border-tactical-red"></div>
          <div className="absolute top-0 right-0 w-4 h-4 border-r-2 border-t-2 border-tactical-red"></div>
          <div className="absolute bottom-0 left-0 w-4 h-4 border-l-2 border-b-2 border-tactical-red"></div>
          <div className="absolute bottom-0 right-0 w-4 h-4 border-r-2 border-b-2 border-tactical-red"></div>

          {/* Heart Icon with CSS animation for beating */}
          <div 
            className="mb-4 relative"
            style={{ 
               animation: bpm && isConnected ? `pulse ${animationDuration}s infinite` : 'none'
            }}
          >
             <Heart 
               className={`w-16 h-16 ${isConnected ? 'text-tactical-red fill-tactical-red/20' : 'text-gray-700'}`} 
               strokeWidth={1.5}
             />
             {isConnected && (
               <div className="absolute inset-0 bg-tactical-red blur-xl opacity-40 animate-pulse"></div>
             )}
          </div>

          <div className="text-center z-10">
            <span className="block text-gray-500 font-mono text-sm tracking-[0.2em] mb-2">HEART RATE</span>
            <div className="flex items-baseline justify-center gap-2">
              <span className={`text-8xl font-mono font-bold tracking-tighter ${isConnected ? 'text-white' : 'text-gray-700'}`}>
                {bpm || '--'}
              </span>
              <span className="text-xl text-tactical-orange font-mono">BPM</span>
            </div>
             {/* Show noise indicator on main display if Sim active on mobile */}
             {isSimulation && isConnected && (
               <div className="sm:hidden mt-4 text-xs font-mono text-gray-500">
                  Noise: {noiseAmplitude}σ
               </div>
             )}
          </div>
        </div>

        {/* Live Chart */}
        <div className="bg-tactical-panel border border-white/10 p-4 flex flex-col min-h-[300px]">
          <div className="flex justify-between items-center mb-4">
             <h3 className="text-sm font-mono text-gray-400 uppercase tracking-wider flex items-center gap-2">
               <Zap className="w-4 h-4 text-yellow-500" />
               Live Telemetry (60s)
             </h3>
             {bpm && (
               <span className={`text-xs font-mono px-2 py-1 border ${isSimulation ? 'text-green-400 bg-green-500/10 border-green-500/30' : 'text-tactical-red bg-tactical-red/10 border-tactical-red/30'}`}>
                 {isSimulation ? 'SIMULATION' : 'LIVE'}
               </span>
             )}
          </div>
          
          <div className="w-full h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorBpm" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ff3333" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#ff3333" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis 
                  dataKey="timeStr" 
                  hide={true} 
                  interval="preserveStartEnd"
                />
                <YAxis 
                  domain={['auto', 'auto']} 
                  hide={true}
                />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#111', borderColor: '#333', color: '#fff' }}
                  itemStyle={{ color: '#ff3333', fontFamily: 'monospace' }}
                  labelStyle={{ display: 'none' }}
                  formatter={(value: number) => [`${value} BPM`]}
                />
                <Area 
                  type="monotone" 
                  dataKey="bpm" 
                  stroke="#ff3333" 
                  strokeWidth={2}
                  fillOpacity={1} 
                  fill="url(#colorBpm)" 
                  isAnimationActive={false} 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          
          <div className="mt-4 pt-4 border-t border-white/5 flex justify-between text-xs font-mono text-gray-500">
             <span>SAMPLES: {history.length}</span>
             <span>BUFFER: 60s</span>
          </div>
        </div>
      </div>
      
      {/* Bridge Configuration Modal */}
      {showBridgeModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-tactical-panel border border-blue-500/30 p-6 w-full max-w-sm shadow-[0_0_50px_rgba(59,130,246,0.1)]">
             <div className="flex justify-between items-center mb-6 border-b border-blue-500/20 pb-2">
                <h3 className="text-blue-400 font-mono text-lg font-bold flex items-center gap-2">
                  <Radio size={20} />
                  BRIDGE CONFIG
                </h3>
                <button onClick={() => setShowBridgeModal(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
             </div>
             
             <div className="space-y-4 font-mono text-sm">
               <div>
                 <label className="block text-gray-500 mb-1">WS SERVER PORT (LOCAL)</label>
                 <input 
                   type="number" 
                   value={tempPort}
                   onChange={(e) => setTempPort(e.target.value)}
                   className="w-full bg-black border border-white/20 p-2 text-white focus:border-blue-500 focus:outline-none"
                   placeholder="8765"
                 />
                 <p className="text-xs text-gray-600 mt-1">Default: 8765. Requires external listener.</p>
               </div>

               <div className="pt-4 flex gap-3">
                 {isWsConnected ? (
                   <button 
                     onClick={() => {
                        onToggleWs(false);
                        setShowBridgeModal(false);
                     }}
                     className="flex-1 bg-red-900/20 border border-red-500/50 text-red-500 py-2 hover:bg-red-500 hover:text-white transition-colors"
                   >
                     STOP SERVER
                   </button>
                 ) : (
                   <button 
                     onClick={() => {
                        onToggleWs(true, parseInt(tempPort) || 8765);
                        setShowBridgeModal(false);
                     }}
                     className="flex-1 bg-blue-900/20 border border-blue-500/50 text-blue-400 py-2 hover:bg-blue-500 hover:text-white transition-colors"
                   >
                     START SERVER
                   </button>
                 )}
               </div>
             </div>
          </div>
        </div>
      )}

      {/* Simulation Modal */}
      {showSimModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
          <div className="bg-tactical-panel border border-purple-500/30 p-6 w-full max-w-md shadow-[0_0_50px_rgba(168,85,247,0.15)]">
             <div className="flex justify-between items-center mb-6 border-b border-purple-500/20 pb-2">
                <h3 className="text-purple-400 font-mono text-lg font-bold flex items-center gap-2">
                  <Cpu size={20} />
                  SELECT PROFILE
                </h3>
                <button onClick={() => setShowSimModal(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
             </div>
             
             <div className="grid grid-cols-1 gap-3 font-mono">
               {simulationOptions.map((opt) => (
                 <button
                    key={opt.id}
                    onClick={() => {
                      startSimulation(opt.id);
                      setShowSimModal(false);
                    }}
                    className={`flex items-start gap-4 p-3 border text-left transition-all ${opt.color}`}
                 >
                    <Play className="mt-1 w-5 h-5 flex-shrink-0" />
                    <div>
                      <div className="font-bold uppercase">{opt.label}</div>
                      <div className="text-xs opacity-70 mb-1">{opt.sub}</div>
                      <div className="text-xs text-gray-500">{opt.desc}</div>
                    </div>
                 </button>
               ))}
             </div>
          </div>
        </div>
      )}

      {/* CSS for custom pulse animation */}
      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); }
          15% { transform: scale(1.15); }
          30% { transform: scale(1); }
          100% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
};

export default Dashboard;