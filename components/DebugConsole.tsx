import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, ChevronUp, Terminal, Trash2, PauseCircle, PlayCircle, Filter, Activity, FileJson } from 'lucide-react';
import { LogEntry } from '../types';

interface DebugConsoleProps {
  logs: LogEntry[];
  onClear: () => void;
}

const DebugConsole: React.FC<DebugConsoleProps> = ({ logs, onClear }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showDataLogs, setShowDataLogs] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter logs based on toggle
  const visibleLogs = useMemo(() => {
    return logs.filter(log => showDataLogs || log.type !== 'data');
  }, [logs, showDataLogs]);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs, autoScroll, isOpen, showRaw]);

  const toggleOpen = () => setIsOpen(!isOpen);

  const getTypeColor = (type: LogEntry['type']) => {
    switch (type) {
      case 'data': return 'text-cyan-400';
      case 'error': return 'text-red-500';
      case 'status': return 'text-yellow-500';
      case 'info': default: return 'text-gray-400';
    }
  };

  return (
    <div className={`
      fixed bottom-0 left-0 right-0 
      bg-tactical-dark border-t border-white/20 shadow-2xl transition-all duration-300 ease-in-out z-50
      ${isOpen ? 'h-[600px]' : 'h-12'}
    `}>
      {/* Header Bar */}
      <div 
        className="h-12 flex items-center justify-between px-4 cursor-pointer hover:bg-white/5 select-none border-b border-black"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-3">
          <Terminal className="w-5 h-5 text-tactical-orange" />
          <span className="font-mono font-bold text-sm tracking-wider uppercase text-gray-300">
            System Log // Bridge Diagnostics
          </span>
          <span className="bg-white/10 text-white/70 text-xs px-2 py-0.5 rounded font-mono">
            {visibleLogs.length} events
          </span>
        </div>
        
        <div className="flex items-center gap-4">
           {isOpen && (
             <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
               {/* Data Stream Toggle */}
               <button 
                 onClick={() => setShowDataLogs(!showDataLogs)}
                 className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-xs font-mono uppercase ${
                   showDataLogs 
                     ? 'bg-cyan-900/30 border-cyan-500/50 text-cyan-400' 
                     : 'bg-transparent border-transparent text-gray-500 hover:bg-white/10'
                 }`}
                 title={showDataLogs ? "Hide Data Stream" : "Show Data Stream"}
               >
                 <Activity size={14} />
                 <span className="hidden sm:inline">Stream {showDataLogs ? 'ON' : 'OFF'}</span>
               </button>

               {/* Raw Data Toggle */}
               <button 
                 onClick={() => setShowRaw(!showRaw)}
                 className={`flex items-center gap-1 px-2 py-1 rounded border transition-colors text-xs font-mono uppercase ${
                   showRaw
                     ? 'bg-orange-900/30 border-orange-500/50 text-orange-400' 
                     : 'bg-transparent border-transparent text-gray-500 hover:bg-white/10'
                 }`}
                 title={showRaw ? "Hide Raw Details" : "Show Raw Details"}
               >
                 <FileJson size={14} />
                 <span className="hidden sm:inline">Raw {showRaw ? 'ON' : 'OFF'}</span>
               </button>

               <div className="w-px h-4 bg-white/10 mx-1"></div>

               {/* Auto Scroll Toggle */}
               <button 
                 onClick={() => setAutoScroll(!autoScroll)}
                 className={`p-1 rounded hover:bg-white/10 ${autoScroll ? 'text-green-500' : 'text-gray-500'}`}
                 title={autoScroll ? "Auto-scroll ON" : "Auto-scroll OFF"}
               >
                 {autoScroll ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
               </button>

               {/* Clear Logs */}
               <button 
                 onClick={onClear}
                 className="p-1 text-gray-500 hover:text-red-500 hover:bg-white/10 rounded transition-colors"
                 title="Clear Logs"
               >
                 <Trash2 size={16} />
               </button>
             </div>
           )}
           {isOpen ? <ChevronDown className="text-gray-500" /> : <ChevronUp className="text-gray-500" />}
        </div>
      </div>

      {/* Log Content */}
      <div 
        ref={scrollRef}
        className="h-[calc(100%-3rem)] overflow-y-auto bg-black/90 p-4 font-mono text-xs space-y-1"
      >
        {visibleLogs.length === 0 ? (
          <div className="text-gray-600 italic px-2">
             {logs.length > 0 ? "Data logs hidden. Check filters." : "No system events logged. Waiting for input..."}
          </div>
        ) : (
          visibleLogs.map((log) => (
            <div key={log.id} className="flex flex-col sm:flex-row gap-1 sm:gap-3 hover:bg-white/5 p-1 rounded border-l-2 border-transparent hover:border-tactical-orange transition-colors items-start">
              <div className="flex gap-3 min-w-fit items-center h-full">
                <span className="text-gray-600 font-mono whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}.{new Date(log.timestamp).getMilliseconds().toString().padStart(3, '0')}
                </span>
                <span className={`uppercase font-bold w-16 ${getTypeColor(log.type)}`}>
                  [{log.type}]
                </span>
              </div>
              
              <div className="flex flex-col sm:flex-row sm:gap-4 flex-1 w-full min-w-0">
                <span className="text-gray-300 whitespace-nowrap overflow-hidden text-ellipsis">
                  {log.message}
                </span>
                {showRaw && log.raw && (
                  <span className="text-tactical-orange opacity-70 font-mono break-all text-[10px] sm:text-xs whitespace-pre-wrap">
                    {log.raw}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default DebugConsole;