import { prisma } from '../db/client';

export async function getStorageMode(userId: string) {
  let mode = await prisma.storageMode.findUnique({ where: { user_id: userId } });
  if (!mode) {
    mode = await prisma.storageMode.create({
      data: { user_id: userId, mode: 'balanced', min_replicas: 1, rebalance_threshold: 0.2 },
    });
  }
  return mode;
}

export async function updateStorageMode(userId: string, data: { mode: string; min_replicas?: number; rebalance_threshold?: number }) {
  return prisma.storageMode.upsert({
    where: { user_id: userId },
    create: { user_id: userId, ...data },
    update: data,
  });
}