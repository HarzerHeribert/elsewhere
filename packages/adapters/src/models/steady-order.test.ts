import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../../models/src/data';
import { steadyFirstJson } from './shared';

const context = (entries: string[], position: number) => ({
  observations: { position },
  memories: [],
  state: {
    actionOffers: [{ id: 'bench', distance: position }],
    pursuits: {
      active: { entries, id: 'p1', question: 'Why?' },
      others: [{ id: 'p0' }],
      reading: [{ text: 'A long page.' }],
    },
    stats: { energy: 50 - position },
  },
});

describe('steadyFirstJson', () => {
  it('holds the same data as canonical JSON', () => {
    const value = context(['a', 'b'], 3);
    expect(JSON.parse(steadyFirstJson(value))).toEqual(JSON.parse(canonicalJson(value)));
  });

  it('writes pages, earlier pursuits and the growing entries before what changes every turn', () => {
    const text = steadyFirstJson(context(['a'], 1));
    const order = ['"reading"', '"others"', '"active"', '"actionOffers"', '"stats"', '"memories"'];
    const at = order.map((key) => text.indexOf(key));
    expect(at.every((index) => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(text.startsWith('{"state":{"pursuits":{"reading"')).toBe(true);
  });

  it('writes what rarely changes before the pursuits', () => {
    const value = context(['a'], 1);
    const text = steadyFirstJson({
      ...value,
      state: { ...value.state, wishes: [], self: { portrait: 'p' }, research: {}, creations: [] },
    });
    const order = ['"self"', '"creations"', '"wishes"', '"research"', '"pursuits"', '"stats"'];
    const at = order.map((key) => text.indexOf(key));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('keeps everything up to the newest entry identical between two turns', () => {
    const before = steadyFirstJson(context(['a', 'b'], 1));
    const after = steadyFirstJson(context(['a', 'b', 'c'], 9));
    const shared = before.slice(0, before.indexOf('"b"') + 3);
    expect(after.startsWith(shared)).toBe(true);
  });
});
