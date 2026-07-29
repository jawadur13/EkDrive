import { Hono } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

interface WebSocketClient {
  userId: string;
  send: (data: string) => void;
  close: () => void;
}

const clients = new Map<string, Set<WebSocketClient>>();

export function broadcastToUser(userId: string, data: string) {
  const userClients = clients.get(userId);
  if (!userClients) return;

  for (const client of userClients) {
    client.send(data);
  }
}

export function broadcastToAll(data: string) {
  for (const [, userClients] of clients) {
    for (const client of userClients) {
      client.send(data);
    }
  }
}

export const wsRouter = new Hono();

wsRouter.get('/ws', (c) => {
  const userId = c.req.query('userId') || 'anonymous';

  const client: WebSocketClient = {
    userId,
    send: (_data: string) => {
      // WebSocket implementation placeholder
    },
    close: () => {
      const userClients = clients.get(userId);
      if (userClients) {
        userClients.delete(client);
        if (userClients.size === 0) {
          clients.delete(userId);
        }
      }
    },
  };

  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(client);

  // In a real implementation, upgrade to WebSocket connection
  return c.json({ message: 'WebSocket endpoint', userId });
});

export class WebSocketManager {
  get router() {
    return wsRouter;
  }
}
