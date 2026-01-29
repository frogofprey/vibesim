import WebSocket, { WebSocketServer } from 'ws';

const DEFAULT_PORT = 8080;

function parsePort(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const p = parseInt(value, 10);
  return !isNaN(p) && p >= 1 && p <= 65535 ? p : null;
}

function resolvePort(): number {
  const fromEnv = parsePort(process.env.WS_PORT);
  if (fromEnv != null) return fromEnv;
  const i = process.argv.indexOf('--ws-port');
  if (i !== -1 && process.argv[i + 1] != null) {
    const fromArgv = parsePort(process.argv[i + 1]);
    if (fromArgv != null) return fromArgv;
  }
  return DEFAULT_PORT;
}

const PORT = resolvePort();
export const WS_SERVER_PORT = PORT;

// Track the single connected client
let connectedClient: WebSocket | null = null;

// Handler for "scan" request from WS client; set by dashboard
let scanRequestHandler: ((reply: (payload: object) => void) => void) | null = null;

export function setScanRequestHandler(fn: ((reply: (payload: object) => void) => void) | null): void {
  scanRequestHandler = fn;
}

// Handler for "connect:<deviceId>" from WS client; set by dashboard
let connectRequestHandler: ((deviceId: string, reply: (payload: object) => void) => void) | null = null;

export function setConnectRequestHandler(fn: ((deviceId: string, reply: (payload: object) => void) => void) | null): void {
  connectRequestHandler = fn;
}

// Create WebSocket server
const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket server started on port ${PORT}`);

wss.on('connection', (ws: WebSocket) => {
  console.log('New client attempting to connect...');

  // If there's already a connected client, close it
  if (connectedClient && connectedClient.readyState === WebSocket.OPEN) {
    console.log('Closing existing client connection...');
    connectedClient.close(1000, 'New client connected');
    connectedClient = null;
  }

  // Set this as the new connected client
  connectedClient = ws;
  console.log('Client connected. Single-client policy enforced.');

  // Handle client disconnect
  ws.on('close', () => {
    console.log('Client disconnected');
    if (connectedClient === ws) {
      connectedClient = null;
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    if (connectedClient === ws) {
      connectedClient = null;
    }
  });

  // Handle incoming messages (e.g. "scan", "connect:<deviceId>")
  ws.on('message', (data: Buffer | string) => {
    const text = (Buffer.isBuffer(data) ? data.toString('utf8') : String(data)).trim();
    const reply = (payload: object) => {
      if (connectedClient && connectedClient.readyState === WebSocket.OPEN && connectedClient === ws) {
        try {
          connectedClient.send(JSON.stringify(payload));
        } catch (err) {
          console.error('Error sending reply to client:', err);
        }
      }
    };
    if (text === 'scan') {
      if (scanRequestHandler) {
        scanRequestHandler(reply);
      } else {
        reply({ action: 'scan_rejected', error: 'Scan not available' });
      }
      return;
    }
    if (text.startsWith('connect:')) {
      const deviceId = text.slice(7).trim();
      if (connectRequestHandler) {
        connectRequestHandler(deviceId, reply);
      } else {
        reply({ action: 'connect_rejected', error: 'Connect not available' });
      }
    }
  });

  // Send welcome message
  ws.send(JSON.stringify({ message: 'Connected to WebSocket server' }));
});

/**
 * Broadcast function that sends heart rate data to the connected client
 * @param deviceId - The device identifier
 * @param heartRate - The heart rate value
 * @param action - Action type: 'hr' for heart rate data, 'disconnected' for disconnect events
 */
export function broadcastHeartRate(deviceId: string, heartRate: number, action: 'hr' | 'disconnected' = 'hr'): void {
  if (!connectedClient || connectedClient.readyState !== WebSocket.OPEN) {
    // No client connected, silently skip
    return;
  }

  const message = {
    device_id: deviceId,
    date: new Date().toISOString(),
    hr: heartRate.toString(),
    action: action
  };

  try {
    connectedClient.send(JSON.stringify(message));
    if (action === 'hr') {
      console.log(`📤 Sent HR data: ${JSON.stringify(message)}`);
    } else {
      console.log(`📤 Sent disconnect: ${JSON.stringify(message)}`);
    }
  } catch (error) {
    console.error('Error sending message to client:', error);
    // Clean up if send failed
    connectedClient = null;
  }
}

/**
 * Broadcast scan result payload to the connected WebSocket client.
 * Used for BLE HRM scan: scan_device (per device) and scan_complete (final list).
 */
export function broadcastScanResult(payload: object): void {
  if (!connectedClient || connectedClient.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    connectedClient.send(JSON.stringify(payload));
  } catch (error) {
    console.error('Error sending scan result to client:', error);
    connectedClient = null;
  }
}

/**
 * Get the current connected client (for testing/debugging)
 */
export function getConnectedClient(): WebSocket | null {
  return connectedClient;
}

// Handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('\nShutting down WebSocket server...');
  if (connectedClient) {
    connectedClient.close();
  }
  wss.close(() => {
    console.log('WebSocket server closed');
    process.exit(0);
  });
});
