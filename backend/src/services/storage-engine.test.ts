import { describe, expect, it } from 'vitest';
import { getChunkCount, planPlacement, type PlacementDrive } from './storage-engine';

const CHUNK = 100;

function drive(id: string, available: number, total: number | null = 1000, used = 0): PlacementDrive {
  return {
    id,
    total_quota_bytes: total === null ? null : BigInt(total),
    used_quota_bytes: BigInt(used),
    available_quota_bytes: BigInt(available),
  };
}

describe('getChunkCount', () => {
  it('rounds up and gives empty files one chunk', () => {
    expect(getChunkCount(0, CHUNK)).toBe(1);
    expect(getChunkCount(100, CHUNK)).toBe(1);
    expect(getChunkCount(101, CHUNK)).toBe(2);
  });
});

describe('planPlacement', () => {
  it('sizes the last chunk to the remainder', () => {
    const plan = planPlacement([drive('a', 1000)], 250, 'max_capacity', 1, CHUNK)!;
    expect(plan.map((p) => p.chunkSize)).toEqual([100, 100, 50]);
  });

  it('spreads a file larger than any single drive across drives', () => {
    const plan = planPlacement([drive('a', 200), drive('b', 150)], 300, 'max_capacity', 1, CHUNK)!;
    expect(plan).not.toBeNull();
    const perDrive = plan.reduce<Record<string, number>>((acc, p) => {
      acc[p.driveIds[0]] = (acc[p.driveIds[0]] ?? 0) + p.chunkSize;
      return acc;
    }, {});
    expect(perDrive.a).toBeLessThanOrEqual(200);
    expect(perDrive.b).toBeLessThanOrEqual(150);
    expect(perDrive.a + perDrive.b).toBe(300);
  });

  it('returns null when total free space is insufficient', () => {
    expect(planPlacement([drive('a', 100), drive('b', 100)], 300, 'max_capacity', 1, CHUNK)).toBeNull();
  });

  it('balanced mode evens out utilization instead of filling one drive', () => {
    const plan = planPlacement([drive('a', 1000, 1000, 0), drive('b', 1000, 1000, 0)], 400, 'balanced', 1, CHUNK)!;
    const onA = plan.filter((p) => p.driveIds[0] === 'a').length;
    expect(onA).toBe(2);
  });

  it('balanced mode prefers the less utilized drive', () => {
    const plan = planPlacement([drive('full', 200, 1000, 800), drive('empty', 200, 1000, 0)], 100, 'balanced', 1, CHUNK)!;
    expect(plan[0].driveIds).toEqual(['empty']);
  });

  it('high reliability stores every chunk on distinct drives', () => {
    const plan = planPlacement([drive('a', 1000), drive('b', 1000), drive('c', 1000)], 250, 'high_reliability', 2, CHUNK)!;
    for (const p of plan) {
      expect(p.driveIds).toHaveLength(2);
      expect(new Set(p.driveIds).size).toBe(2);
    }
  });

  it('high reliability needs at least two drives even if minReplicas is 1', () => {
    expect(planPlacement([drive('a', 1000)], 50, 'high_reliability', 1, CHUNK)).toBeNull();
  });

  it('treats a drive without a quota limit as having space', () => {
    const plan = planPlacement([drive('unlimited', Number.MAX_SAFE_INTEGER, null)], 500, 'balanced', 1, CHUNK);
    expect(plan).toHaveLength(5);
  });
});
