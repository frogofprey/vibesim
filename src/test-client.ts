import WebSocket from 'ws';

const SERVER_URL = 'ws://localhost:8080';

let client1: WebSocket | null = null;
let client2: WebSocket | null = null;
let client1MessageCount = 0;
let client2MessageCount = 0;
let client1StartTime: number | null = null;
let client2StartTime: number | null = null;
let client1Disconnected = false;

function createClient(id: string): WebSocket {
  const ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log(`[Client ${id}] ✅ Connected to server`);
    if (id === '1' && !client1StartTime) {
      client1StartTime = Date.now();
    }
    if (id === '2' && !client2StartTime) {
      client2StartTime = Date.now();
    }
  });

  ws.on('message', (data: Buffer) => {
    try {
      const message = JSON.parse(data.toString());
      
      if (message.action === 'hr') {
        if (id === '1') {
          client1MessageCount++;
          const elapsed = client1StartTime ? ((Date.now() - client1StartTime) / 1000).toFixed(1) : '0';
          console.log(`[Client ${id}] ❤️  HR update #${client1MessageCount} (${elapsed}s): HR=${message.hr} bpm`);
        } else {
          client2MessageCount++;
          const elapsed = client2StartTime ? ((Date.now() - client2StartTime) / 1000).toFixed(1) : '0';
          console.log(`[Client ${id}] ❤️  HR update #${client2MessageCount} (${elapsed}s): HR=${message.hr} bpm`);
        }
      } else {
        console.log(`[Client ${id}] 📨 Received:`, message);
      }
    } catch (error) {
      console.error(`[Client ${id}] ❌ Error parsing message:`, error);
    }
  });

  ws.on('close', (code: number, reason: Buffer) => {
    const reasonStr = reason.toString();
    console.log(`[Client ${id}] 🔌 Disconnected (code: ${code}, reason: ${reasonStr})`);
    if (id === '1') {
      client1Disconnected = true;
      if (reasonStr.includes('New client')) {
        console.log(`[Client ${id}] ✅ Correctly kicked off by new client!`);
      }
    }
  });

  ws.on('error', (error: Error) => {
    console.error(`[Client ${id}] ❌ Error:`, error.message);
  });

  return ws;
}

console.log('=== WebSocket Test Client ===');
console.log('Make sure the server is running (npm run server)');
console.log('and test-server is broadcasting (npm run test-server)\n');

// Test 1: Single client connection and message reception
console.log('=== Test 1: Single Client Connection ===');
console.log('Connecting Client 1...\n');
client1 = createClient('1');

// Wait 5 seconds, then connect a second client to test kick-off logic
setTimeout(() => {
  console.log('\n=== Test 2: Single-Client Policy Test ===');
  console.log('Connecting Client 2 - Client 1 should be disconnected...\n');
  client2 = createClient('2');
}, 5000);

// Run test for 15 seconds total
setTimeout(() => {
  console.log('\n=== Test Summary ===');
  console.log(`Client 1:`);
  console.log(`  - Messages received: ${client1MessageCount}`);
  console.log(`  - Expected: ~5 messages (1 per second for 5 seconds before kick-off)`);
  console.log(`  - Disconnected: ${client1Disconnected ? 'Yes ✅' : 'No ❌'}`);
  console.log(`\nClient 2:`);
  console.log(`  - Messages received: ${client2MessageCount}`);
  console.log(`  - Expected: ~10 messages (1 per second for 10 seconds)`);
  console.log(`  - Status: ${client2 && client2.readyState === WebSocket.OPEN ? 'Connected ✅' : 'Disconnected'}`);
  
  // Verify test results
  const test1Pass = client1MessageCount >= 4 && client1MessageCount <= 6; // Allow some variance
  const test2Pass = client1Disconnected;
  const test3Pass = client2MessageCount >= 9 && client2MessageCount <= 11; // Allow some variance
  
  console.log(`\n=== Test Results ===`);
  console.log(`Test 1 (Client 1 receives ~1 msg/sec): ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Test 2 (Client 1 kicked off): ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`Test 3 (Client 2 receives ~1 msg/sec): ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
  
  if (client1) {
    client1.close();
  }
  if (client2) {
    client2.close();
  }
  
  setTimeout(() => {
    process.exit(test1Pass && test2Pass && test3Pass ? 0 : 1);
  }, 1000);
}, 15000);
