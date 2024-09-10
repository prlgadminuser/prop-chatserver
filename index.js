const WebSocket = require('ws');
const http = require('http');
const axios = require('axios');
const Limiter = require('limiter').RateLimiter;

const server = http.createServer();
const wss = new WebSocket.Server({ noServer: true });

const globalChatPlayers = new Map();
const chatHistory = [];
const maxMessages = 4;

const connectionRate = 1;
const connectionBurst = 1;
const connectionInterval = 5000; // 5 seconds
const tokenBucket = new Limiter({
  tokensPerInterval: connectionRate,
  interval: connectionInterval,
  maxBurst: connectionBurst,
});

const messageRate = 1; // 1 message per second
const messageBurst = 1;
const messageTokenBucket = new Limiter({
  tokensPerInterval: messageRate,
  interval: 'second',
  maxBurst: messageBurst,
});

const maxMessageLength = 100;

const allowedOrigins = [
  "https://uploads.ungrounded.net",
  "https://slcount.netlify.app",
  "https://s-r.netlify.app",
  "https://serve.gamejolt.net",
  "null",
  "tw-editor://.",
  "http://serve.gamejolt.net",
  "https://www.newgrounds.com/portal/view/5561763",
  "https://www.newgrounds.com/projects/games/5561763/preview",
  "https://prod-dpgames.crazygames.com",
  "https://crazygames.com",
  "https://crazygames.com/game/skilled-royale",
  "https://html-classic.itch.zone",
  "https://turbowarp.org",
  "https://s-ri0p-delgae.netlify.app",
];

async function joinGlobalChat(ws, token) {
  try {
    const expectedOrigin = 'tw-editor://.';
    const response = await axios.get(`https://liquemgames-api.netlify.app/verify-token/${token}`, {
      headers: {
        Origin: expectedOrigin,
      },
    });

    const playerId = response.data.message;
    
    // If token is invalid or playerId is not returned
    if (!playerId) {
      ws.close(4001, 'Invalid token');
      return null;
    }

    // Check if the player ID already exists
    if (globalChatPlayers.has(playerId)) {
      ws.close(4003, 'Duplicate player ID');
      return null;
    }

    // Add player to the global chat players map
    globalChatPlayers.set(playerId, { ws });

    // Send the entire chat history to the new connection
    ws.send(JSON.stringify({ type: 'chat', messages: chatHistory }));

    return playerId;
  } catch (error) {
    console.error('Error verifying token:', error);
    ws.close(4000, 'Token verification error');
    return null;
  }
}

function broadcastGlobal(playerId, message) {
  const messageString = String(message).trim();

  // Validate message length
  if (messageString.length === 0 || messageString.length > maxMessageLength) {
    console.error('Message length is invalid:', messageString);
    return;
  }

  // Rate limit messages
  if (!messageTokenBucket.tryRemoveTokens(1)) {
    console.error('Message rate limit exceeded:', messageString);
    return;
  }

  const filteredMessage = messageString.toLowerCase().includes('badword')
    ? 'Filtered message'
    : messageString;

  const timestamp = new Date().toLocaleTimeString();

  const newMessage = {
    id: chatHistory.length + 1,
    timestamp: timestamp,
    playerId: playerId,
    message: filteredMessage,
  };

  chatHistory.push(newMessage);

  // Trim chat history to the last 'maxMessages' messages
  if (chatHistory.length > maxMessages) {
    chatHistory.splice(0, chatHistory.length - maxMessages);
  }

  // Broadcast the updated chat history to all connected players
  for (const player of globalChatPlayers.values()) {
    player.ws.send(JSON.stringify({ type: 'chat', messages: chatHistory }));
  }
}

wss.on('connection', (ws, req) => {
  const token = req.url.slice(1);
  const ip = req.headers['true-client-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress;

  // Validate request origin
  if (!allowedOrigins.includes(req.headers.origin)) {
    ws.close(4004, 'Unauthorized origin');
    return;
  }

  // Rate-limit connection attempts
  if (tokenBucket.tryRemoveTokens(1)) {
    joinGlobalChat(ws, token)
      .then((playerId) => {
        if (!playerId) {
          console.error('Failed to join global chat');
          return;
        }

        console.log('Joined global chat:', playerId);

        ws.on('message', (message) => {
          try {
            const data = JSON.parse(message);
            if (data.type === 'chat') {
              broadcastGlobal(playerId, data.message);
            }
          } catch (error) {
            console.error('Error handling message:', error);
          }
        });

        ws.on('close', () => {
          globalChatPlayers.delete(playerId);
          console.log('Player disconnected:', playerId);
        });
      })
      .catch((error) => {
        console.error('Error during joinGlobalChat:', error);
      });
  } else {
    console.log('Connection rate-limited:', ip);
    ws.close(4002, 'Connection rate-limited. Too many connections in a short period.');
  }
});

server.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
