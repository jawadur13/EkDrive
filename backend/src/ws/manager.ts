import { Hono } from 'hono';
import { upgradeWebSocket } from 'hono/websocket';
import { WebSocket } from 'ws';

interface WebSocketClient extends WebSocket {
  userId?: string;
  isAlive: boolean;
}

const clients = new Map<string, Set<WebSocketClient>>();

export function broadcastToUser(userId: string, data: string) {
  const userClients = clients.get(userId);
  if (!userClients) return;

  for (const client of userClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  }
}

export function broadcastToAll(data: string) {
  for (const [, userClients] of clients) {
    for (const client of userClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}

export const wsRouter = new Hono();

wsRouter.get('/ws', upgradeWebSocket((c) => {
  const userId = c.req.query('userId') || 'anonymous';

  const ws: WebSocketClient = {
    ...new WebSocket('ws://placeholder'),
    userId,
    isAlive: true,
  };

  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(ws);

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      if (data.type === 'ping') {
        ws.isAlive = true;
      }
    } catch {
      // Ignore invalid messages
    }
  });

  ws.on('close', () => {
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  });

  ws.on('error', () => {
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(ws);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
  });

  const interval = setInterval(() => {
    for (const [, userClients] of clients) {
      for (const client of userClients) {
        if (!client.isAlive) {
          client.terminate();
          userClients.delete(client);
        }
        client.isAlive = false;
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }
  }, 30000);

  ws.on('close', () => {
    clearInterval(interval);
  });

  return {
    onOpen: () => {
      console.log(`WebSocket client connected: ${userId}`);
    },
    onMessage: (event) => {
      // Handle incoming messages
    },
    onClose: () => {
      console.log(`WebSocket client disconnected: ${userId}`);
    },
  };
}));

export class WebSocketManager {
  get router() {
    return wsRouter;
  }
}