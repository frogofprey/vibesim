import WebSocket, { WebSocketServer } from 'ws';

const PORT = 8080;

// Track the single connected client
let connectedClient: WebSocket | null = null;

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
