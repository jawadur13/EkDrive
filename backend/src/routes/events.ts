import { Hono } from 'hono';
import { subscribe, type LiveEvent } from '../services/events';

export const eventRoutes = new Hono();

/** Proxies and browsers drop a quiet connection; this keeps it alive and detects a dead one. */
const HEARTBEAT_MS = 25_000;

// Server-sent events rather than a WebSocket: everything here flows one way, the browser
// reconnects on its own, and it rides the same cookie-authenticated origin as the rest.
eventRoutes.get('/', (c) => {
  const userId = (c as any).get('userId') as string;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: LiveEvent | { type: 'ping' }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = subscribe(userId, send);
      // unref: a forgotten stream must never be the reason the process will not exit.
      const heartbeat = setInterval(() => send({ type: 'ping' }), HEARTBEAT_MS);
      heartbeat.unref?.();

      function cleanup() {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // Already closed by the client going away.
        }
      }

      // Tells the browser to wait a moment before reconnecting after a restart.
      controller.enqueue(encoder.encode('retry: 5000\n\n'));
      c.req.raw.signal.addEventListener('abort', cleanup);
    },
  });

  return c.body(stream, 200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    // nginx buffers proxied responses by default, which would hold every event back.
    'X-Accel-Buffering': 'no',
  });
});
