import { describe, expect, it } from 'vitest';
import { AdmissionPool, ResponseBudget, WindowQuota } from '../src/admission';

describe('bounded traffic accounting', () => {
  it('does not let new identities evict existing buckets or grow memory beyond capacity', () => {
    const quota = new WindowQuota(2);
    expect(quota.consume('legitimate', 3, 1000).allowed).toBe(true);
    expect(quota.consume('other', 3, 1000).allowed).toBe(true);
    for (let index = 0; index < 10000; index++)
      expect(quota.consume(`new:${index}`, 3, 1000).allowed).toBe(false);
    expect(quota.size).toBe(2);
    expect(quota.consume('legitimate', 3, 1000).allowed).toBe(true);
    expect(quota.consume('new', 3, 61000).allowed).toBe(true);
    expect(quota.size).toBe(1);
  });

  it('caps active work without allocating a waiting queue and releases slots only once', () => {
    const pool = new AdmissionPool(2, 1);
    const first = pool.enter('first')!;
    expect(pool.enter('first')).toBeNull();
    const second = pool.enter('second')!;
    expect(pool.enter('third')).toBeNull();
    first();
    first();
    const third = pool.enter('third')!;
    expect(pool.enter('fourth')).toBeNull();
    second();
    third();
    expect(pool.enter('first')).not.toBeNull();
  });

  it('reserves before work, refunds unused room, and bounds replies across window changes', () => {
    const budget = new ResponseBudget(1000, 400);
    const a = budget.reserve(0)!;
    const b = budget.reserve(0)!;
    expect(budget.reserve(0)).toBeNull();
    expect(a.commit(100, 0)).toBe(true);
    const c = budget.reserve(0)!;
    expect(b.commit(401, 0)).toBe(false);
    expect(b.commit(1, 0)).toBe(false);
    const d = budget.reserve(60000)!;
    const e = budget.reserve(60000)!;
    expect(c.commit(300, 60000)).toBe(false);
    expect(d.commit(350, 60000)).toBe(true);
    expect(e.commit(350, 60000)).toBe(true);
    expect(budget.reserve(0)).toBeNull();
  });
});
