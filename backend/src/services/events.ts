import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger';

export type LiveEvent =
  | { type: 'notification'; title: string; severity: string }
  | { type: 'files.changed' }
  | { type: 'drives.changed'; driveId?: string; status?: string }
  | { type: 'sync.finished'; missingChunks: number; filesRepaired: number }
  | { type: 'rebalance.finished'; chunksMoved: number; copiesAdded: number; copiesRemoved: number };

// In-process fan-out, which is as far as a single backend needs to go. With several instances
// this becomes a Redis pub/sub channel and nothing else about the API changes.
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(userId: string, event: LiveEvent) {
  bus.emit(userId, event);
}

export function subscribe(userId: string, listener: (event: LiveEvent) => void) {
  bus.on(userId, listener);
  logger.debug({ userId, listeners: bus.listenerCount(userId) }, 'Live updates subscribed');
  return () => {
    bus.off(userId, listener);
  };
}
