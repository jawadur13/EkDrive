import { prisma } from '../db/client';

export async function getUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}