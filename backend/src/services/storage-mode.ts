import { prisma } from '../db/client';

export type StorageModeName = 'max_capacity' | 'balanced' | 'high_reliability';

export async function getStorageMode(userId: string) {
  return prisma.storageMode.upsert({
    where: { user_id: userId },
    create: { user_id: userId, mode: 'balanced', min_replicas: 1, rebalance_threshold: 0.2 },
    update: {},
  });
}

export async function updateStorageMode(
  userId: string,
  data: { mode?: StorageModeName; min_replicas?: number; rebalance_threshold?: number }
) {
  // High reliability without a second copy is not high reliability.
  const minReplicas = data.mode === 'high_reliability' && (data.min_replicas ?? 0) < 2 ? 2 : data.min_replicas;
  const update = { ...data, ...(minReplicas !== undefined ? { min_replicas: minReplicas } : {}), updated_at: new Date() };

  const [mode] = await prisma.$transaction([
    prisma.storageMode.upsert({
      where: { user_id: userId },
      create: { user_id: userId, mode: 'balanced', ...update },
      update,
    }),
    ...(data.mode ? [prisma.user.update({ where: { id: userId }, data: { storage_mode: data.mode } })] : []),
  ]);
  return mode;
}
