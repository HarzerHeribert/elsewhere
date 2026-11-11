import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderStudio } from '../app/studio';
import { ElsewhereController, type ControllerState } from '../app/controller';
import type { SnapshotStore, StoredSnapshot } from '../packages/persistence/src/index';
import type { ExpressionProvider } from '../packages/adapters/src/models/expression';
import type { CharacterStudio } from '../characters/interfaces/src/studio';
import type { CharacterCommand } from '@elsewhere/character-interfaces';
import type { DecisionContext } from '@elsewhere/character-runtime';
import { scriptedProvider, type ScriptedProvider } from './scripted-provider';

const start = Date.UTC(2026, 10, 9, 12, 10);
const OUTSIDE = 'The quick brown fox jumps over the lazy dog beside the quiet river bank.';
const AUTHORED = '# Shadows\n\nThe sundial shadow was 40 cm long when I looked.';
const SITE = 'https://studio.invalid/';
const make = {
  type: 'make' as const,
  path: 'notes/shadows.md',
  title: 'What the sundial said',
  about: 'A short page about the shadow I measured.',
};

class MemoryStore implements SnapshotStore<ControllerState> {
  saved: StoredSnapshot<ControllerState> | null = null;
  async load() {
    return structuredClone(this.saved);
  }
  async save(value: ControllerState, expected: number) {
    this.saved = { version: expected + 1, value: structuredClone(value) };
    return expected + 1;
  }
  async close() {}
}
const open = new Set<ElsewhereController>();
const directories: string[] = [];
afterEach(async () => {
  for (const controller of open) await controller.close();
  open.clear();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
const folder = () => {
  const path = mkdtempSync(join(tmpdir(), 'make-'));
  directories.push(path);
  return path;
};

/** Follows a question, tries the sundial, notes it, goes to the workbench and makes one file. */
const maker =
  (command: CharacterCommand = make) =>
  (context: DecisionContext) => {
    const state = context.state as unknown as {
      pursuits: { active: { entries: Array<{ kind: string }> } | null };
      actionOffers: Array<{ id: string; ready: string[] }>;
    };
    const kinds = state.pursuits.active?.entries.map((entry) => entry.kind) ?? [];
    if (!state.pursuits.active)
      return {
        type: 'pursue' as const,
        question: 'How long is the sundial shadow?',
        why: 'I want to know what it tells me.',
      };
    const offer = (id: string) => state.actionOffers.find((item) => item.id === id);
    if (!kinds.includes('tried'))
      return offer('sundial')?.ready.includes('use')
        ? { type: 'use' as const, targetId: 'sundial', control: 'read' }
        : { type: 'move' as const, targetId: 'sundial' };
    if (!kinds.includes('note'))
      return { type: 'note' as const, text: 'The shadow was about 40 cm.', surprised: false };
    if (offer('workbench')?.ready.includes('make')) return command;
    // The workshop is a place to walk to before its workbench can be approached.
    return { type: 'move' as const, targetId: offer('workbench') ? 'workbench' : 'workshop' };
  };

function expression(text: string | (() => string) = AUTHORED) {
  const express = vi.fn(async (_input: unknown) => (typeof text === 'string' ? text : text()));
  const provider: ExpressionProvider = {
    id: 'scripted-test-fixture',
    localOnly: true,
    express: express as ExpressionProvider['express'],
  };
  return { provider, express };
}

async function create(
  provider: ScriptedProvider,
  options: Partial<ConstructorParameters<typeof ElsewhereController>[1]>,
) {
  const store = new MemoryStore();
  const controller = await new ElsewhereController(store, {
    now: () => start,
    modelProvider: provider,
    ...options,
  }).init();
  open.add(controller);
  return { controller, store };
}
/** Steps until the resident has tried to make something, or fails. */
async function untilMade(controller: ElsewhereController, store: MemoryStore) {
  for (let step = 0; step < 80; step++) {
    await controller.step();
    if (store.saved!.value.hubert.trail.some((entry) => entry.kind === 'make')) return;
  }
  throw new Error('The resident never made anything.');
}

describe('making a file of the resident’s own site', () => {
  it('writes the authored text, shelves it, and records it on the pursuit and the trail', async () => {
    const directory = folder();
    const provider = scriptedProvider([], { fallback: maker() });
    const authored = expression();
    const { controller, store } = await create(provider, {
      studio: createFolderStudio(directory, SITE),
      expressionProvider: authored.provider,
    });
    await untilMade(controller, store);
    expect(readFileSync(join(directory, 'notes/shadows.md'), 'utf8')).toBe(AUTHORED);
    const pageUrl = SITE + 'notes/shadows.html';
    const saved = store.saved!.value;
    expect(saved.creations).toEqual([
      expect.objectContaining({
        title: make.title,
        description: make.about,
        url: pageUrl,
        kind: 'document',
        provenance: 'character',
        origin: expect.objectContaining({
          path: make.path,
          pursuitId: saved.hubert.pursuits.activeId,
        }),
      }),
    ]);
    expect(saved.creations![0].origin!.commitSha).toMatch(/^[a-f0-9]{64}$/);
    const entries = saved.hubert.pursuits.items[0].entries;
    expect(entries.at(-1)).toMatchObject({
      kind: 'made',
      creationId: saved.creations![0].id,
      path: make.path,
      title: make.title,
      url: pageUrl,
      commitSha: saved.creations![0].origin!.commitSha,
    });
    expect(saved.hubert.trail.at(-1)).toMatchObject({
      kind: 'make',
      text: make.title,
      url: pageUrl,
      pursuitId: saved.hubert.pursuits.activeId,
    });
    expect(saved.hubert.lastOutcome).toMatchObject({
      status: 'completed',
      summary: `Published ${make.path} at ${pageUrl}.`,
    });
    expect(saved.world.events.at(-1)!.message).toBe(`Hubert made ${make.title}.`);
    // One decision plus one authoring request for this step, and the request carried the record.
    expect(saved.modelAllowance.calls).toBe(provider.contexts.length + 1);
    expect(authored.express).toHaveBeenCalledTimes(1);
    const input = authored.express.mock.calls[0][0] as {
      form: string;
      material: { notes: string[]; readings: string[] };
      existing?: string;
    };
    expect(input).toMatchObject({ form: 'work', path: make.path, siteUrl: SITE });
    expect(input.material.notes).toEqual(['The shadow was about 40 cm.']);
    expect(input.material.readings[0]).toMatch(/^Tried read on/);
    expect(input).not.toHaveProperty('existing');
    expect(controller.getSnapshot().creations).toHaveLength(1);
    // The next decision sees the studio and what it holds.
    await controller.step();
    expect(provider.contexts.at(-1)!.state.studio).toEqual({
      site: SITE,
      files: [{ path: make.path, title: make.title, at: expect.any(Number) }],
    });
  });

  it('rewrites an existing file with its current text and keeps one creation', async () => {
    const directory = folder();
    const studio = createFolderStudio(directory, SITE);
    await studio.write({ path: make.path, text: 'old text', message: 'first' });
    const provider = scriptedProvider([], { fallback: maker() });
    const authored = expression();
    const write = vi.spyOn(studio, 'write');
    const { controller, store } = await create(provider, {
      studio,
      expressionProvider: authored.provider,
    });
    await untilMade(controller, store);
    expect((authored.express.mock.calls[0][0] as { existing: string }).existing).toBe('old text');
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ message: make.title, expectedSha: expect.any(String) }),
    );
    expect(readFileSync(join(directory, make.path), 'utf8')).toBe(AUTHORED);
    await controller.step();
    // Making the same file again leaves the shelf as it is.
    expect(store.saved!.value.creations).toHaveLength(1);
  });

  it('writes nothing and says why when the resident is not at the workbench', async () => {
    const directory = folder();
    const provider = scriptedProvider([], { fallback: make });
    const authored = expression();
    const { controller, store } = await create(provider, {
      studio: createFolderStudio(directory, SITE),
      expressionProvider: authored.provider,
    });
    await controller.step();
    const saved = store.saved!.value;
    expect(existsSync(join(directory, 'notes'))).toBe(false);
    expect(authored.express).not.toHaveBeenCalled();
    expect(saved.creations ?? []).toEqual([]);
    expect(saved.hubert.lastOutcome).toMatchObject({ action: 'make', status: 'rejected' });
    expect(saved.hubert.lastOutcome!.summary).toContain('workbench');
    expect(saved.hubert.lastDecisionProblem?.message).toContain('workbench');
    expect(saved.hubert.trail.filter((entry) => entry.kind === 'make')).toEqual([]);
    expect(saved.modelAllowance.calls).toBe(1);
  });

  it('writes nothing without a studio, and the resident is never offered making', async () => {
    const provider = scriptedProvider([], { fallback: maker() });
    const authored = expression();
    const { controller, store } = await create(provider, { expressionProvider: authored.provider });
    for (let step = 0; step < 30; step++) await controller.step();
    const saved = store.saved!.value;
    expect(authored.express).not.toHaveBeenCalled();
    expect(saved.creations ?? []).toEqual([]);
    expect(provider.contexts.at(-1)!.state).not.toHaveProperty('studio');
    expect(JSON.stringify(provider.contexts.map((context) => context.choices))).not.toContain(
      '"make"',
    );
    // A proposal made anyway is refused with the reason.
    const stubborn = scriptedProvider([], { fallback: make });
    const other = await create(stubborn, { expressionProvider: authored.provider });
    await other.controller.step();
    expect(other.store.saved!.value.hubert.lastOutcome!.summary).toContain('no studio');
  });

  it('does not publish authored text that repeats a private outside message', async () => {
    const directory = folder();
    const provider = scriptedProvider([], { fallback: maker() });
    const authored = expression(`# Shadows\n\nSomeone wrote: ${OUTSIDE}`);
    const { controller, store } = await create(provider, {
      studio: createFolderStudio(directory, SITE),
      expressionProvider: authored.provider,
    });
    await controller.submitMessage(OUTSIDE);
    await untilMade(controller, store);
    const saved = store.saved!.value;
    expect(authored.express).toHaveBeenCalledTimes(1);
    expect(existsSync(join(directory, 'notes'))).toBe(false);
    expect(saved.creations ?? []).toEqual([]);
    expect(saved.hubert.trail.at(-1)).toMatchObject({
      kind: 'make',
      text: `${make.title} — not published`,
    });
    expect(saved.hubert.trail.at(-1)!.url).toBeUndefined();
    expect(saved.hubert.lastOutcome).toMatchObject({ status: 'rejected' });
    expect(saved.hubert.pursuits.items[0].entries.some((entry) => entry.kind === 'made')).toBe(
      false,
    );
    expect(JSON.stringify(controller.getSnapshot())).not.toContain('quiet river bank');
  });

  it('leaves no creation when the studio refuses the write, and says only the kind of failure', async () => {
    const directory = folder();
    const inner = createFolderStudio(directory, SITE);
    const studio: CharacterStudio = {
      ...inner,
      write: async () => {
        throw new Error('SECRET-PROVIDER-DETAIL');
      },
    };
    const provider = scriptedProvider([], { fallback: maker() });
    const { controller, store } = await create(provider, {
      studio,
      expressionProvider: expression().provider,
    });
    await untilMade(controller, store);
    const saved = store.saved!.value;
    expect(existsSync(join(directory, 'notes'))).toBe(false);
    expect(saved.creations ?? []).toEqual([]);
    expect(saved.hubert.trail.at(-1)).toMatchObject({
      kind: 'make',
      text: `${make.title} — not published`,
    });
    expect(saved.hubert.lastOutcome).toMatchObject({ status: 'rejected' });
    expect(JSON.stringify(saved)).not.toContain('SECRET-PROVIDER-DETAIL');
  });

  it('fails quietly, spending nothing more, when the allowance has no call left for the text', async () => {
    // First learn how many decisions lead up to the attempt.
    const probe = await create(scriptedProvider([], { fallback: maker() }), {
      studio: createFolderStudio(folder(), SITE),
      expressionProvider: expression().provider,
    });
    await untilMade(probe.controller, probe.store);
    const decisions = probe.store.saved!.value.modelAllowance.calls - 1;
    // Then allow only those: the decision for the step takes the last call.
    const directory = folder();
    const authored = expression();
    const { controller, store } = await create(scriptedProvider([], { fallback: maker() }), {
      studio: createFolderStudio(directory, SITE),
      expressionProvider: authored.provider,
      modelMaximum: decisions,
    });
    for (let step = 0; step < decisions + 3; step++) await controller.step();
    const saved = store.saved!.value;
    expect(saved.modelAllowance.calls).toBe(decisions);
    expect(saved.hubert.lastOutcome).toMatchObject({ action: 'make', status: 'rejected' });
    expect(authored.express).not.toHaveBeenCalled();
    expect(existsSync(join(directory, 'notes'))).toBe(false);
    expect(saved.creations ?? []).toEqual([]);
    expect(saved.hubert.trail.filter((entry) => entry.kind === 'make')).toEqual([]);
  });
});
