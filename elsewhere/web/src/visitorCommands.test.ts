import { describe, expect, it, vi } from 'vitest';
import type { VisitorAction } from '@elsewhere/character-interfaces';
import { VisitorCommandQueue } from './visitorCommands';

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
describe('visitor command ordering', () => {
  it('sends a stop after an in-flight move and discards stale queued movement', async () => {
    const sent: VisitorAction[] = [];
    let finishFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const queue = new VisitorCommandQueue(async (command) => {
      sent.push(command);
      if (sent.length === 1) await first;
    }, 20);
    queue.enqueue({ type: 'move', position: { x: 1, z: 1 } });
    queue.enqueue({ type: 'move', position: { x: 2, z: 2 } });
    queue.enqueue({ type: 'look', facing: 1 });
    queue.enqueue({ type: 'stop' });
    expect(sent.map((command) => command.type)).toEqual(['move']);
    finishFirst();
    await flush();
    expect(sent.map((command) => command.type)).toEqual(['move', 'stop']);
    queue.dispose();
  });
  it('does not throttle away a stop just after a successful movement', async () => {
    const sent: VisitorAction[] = [];
    const queue = new VisitorCommandQueue(async (command) => {
      sent.push(command);
    }, 1000);
    queue.enqueue({ type: 'move', position: { x: 1, z: 1 } });
    await flush();
    queue.enqueue({ type: 'stop' });
    await flush();
    expect(sent.map((command) => command.type)).toEqual(['move', 'stop']);
    queue.dispose();
  });
  it('keeps only the newest pending movement', async () => {
    const sent: VisitorAction[] = [];
    const queue = new VisitorCommandQueue(async (command) => {
      sent.push(command);
    }, 10);
    queue.enqueue({ type: 'look', facing: 0 });
    await flush();
    queue.enqueue({ type: 'move', position: { x: 2, z: 2 } });
    queue.enqueue({ type: 'move', position: { x: 3, z: 3 } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent[1]).toEqual({ type: 'move', position: { x: 3, z: 3 } });
    queue.dispose();
  });
  it('retries a lost stop before a subsequent move without replaying failed movement', async () => {
    vi.useFakeTimers();
    const sent: VisitorAction[] = [];
    const queue = new VisitorCommandQueue(async (command) => {
      sent.push(command);
      if (sent.length === 1) throw new Error('Disconnected');
    }, 0);
    try {
      queue.enqueue({ type: 'stop' });
      await vi.advanceTimersByTimeAsync(0);
      queue.enqueue({ type: 'move', position: { x: 3, z: 3 } });
      await vi.advanceTimersByTimeAsync(250);
      expect(sent.map((command) => command.type)).toEqual(['stop', 'stop', 'move']);
    } finally {
      queue.dispose();
      vi.useRealTimers();
    }
  });
  it('does not resurrect commands after clearing an in-flight failed stop', async () => {
    const sent: VisitorAction[] = [];
    let reject!: (error: Error) => void;
    const queue = new VisitorCommandQueue(async (command) => {
      sent.push(command);
      await new Promise<void>((_, fail) => {
        reject = fail;
      });
    }, 0);
    queue.enqueue({ type: 'stop' });
    queue.clear();
    reject(new Error('Disconnected'));
    await flush();
    expect(sent).toEqual([{ type: 'stop' }]);
    queue.dispose();
  });
});
