import { prisma } from '../db/client';
import { z } from 'zod';

const loginSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export async function getUserByEmail(email: string) {
  return prisma.user.findUnique({ where: { email } });
}

export async function createUser(data: { email: string; displayName?: string; avatarUrl?: string }) {
  return prisma.user.create({ data });
}

export async function updateUser(userId: string, data: Partial<{ displayName: string; avatarUrl: string }>) {
  return prisma.user.update({ where: { id: userId }, data });
}

export async function getUserById(userId: string) {
  return prisma.user.findUnique({ where: { id: userId } });
}