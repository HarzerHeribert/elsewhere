import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CharacterCommandSchema, type CharacterCommand } from '@elsewhere/character-interfaces';

export function ownerToken(dataDirectory: string, supplied?: string): string {
  if (supplied) {
    if (supplied.length < 32) throw new Error('ADMIN_TOKEN must be at least 32 characters.');
    return supplied;
  }
  mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  const path = join(dataDirectory, 'owner-token');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const token = randomBytes(32).toString('hex');
  writeFileSync(path, token, { mode: 0o600, flag: 'wx' });
  chmodSync(path, 0o600);
  return token;
}

export function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Policy is trusted application code, never mutable character state. */
export function authorizeCommand(
  input: unknown,
): { allowed: true; command: CharacterCommand } | { allowed: false; reason: string } {
  const parsed = CharacterCommandSchema.safeParse(input);
  if (!parsed.success)
    return { allowed: false, reason: 'The proposal does not match an allowed action.' };
  if (parsed.data.type === 'delegate')
    return {
      allowed: false,
      reason: 'External coding workers are not connected. No job was started.',
    };
  if (parsed.data.type === 'say')
    return {
      allowed: false,
      reason:
        'Unreviewed public speech is disabled. Private inputs cannot be republished through a tool.',
    };
  return { allowed: true, command: parsed.data };
}

export interface ModelAllowance {
  day: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** UTC hour bucket (YYYY-MM-DDTHH); only maintained when an hourly maximum is used. */
  hour?: string;
  hourCalls?: number;
}
export function reserveModelCall(
  ledger: ModelAllowance,
  now: number,
  maximum: number,
  hourlyMaximum?: number,
): ModelAllowance | null {
  const iso = new Date(now).toISOString();
  const day = iso.slice(0, 10);
  const current = ledger.day >= day ? ledger : { day, calls: 0, inputTokens: 0, outputTokens: 0 };
  if (current.calls >= maximum) return null;
  if (hourlyMaximum === undefined) return { ...current, calls: current.calls + 1 };
  const hour = iso.slice(0, 13);
  const hourCalls = current.hour === hour ? (current.hourCalls ?? 0) : 0;
  if (hourCalls >= hourlyMaximum) return null;
  return { ...current, calls: current.calls + 1, hour, hourCalls: hourCalls + 1 };
}
