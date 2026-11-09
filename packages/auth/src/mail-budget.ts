import { createHmac } from 'node:crypto';
import type Database from 'better-sqlite3';
import type pg from 'pg';
import { z } from 'zod';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MAX_RECIPIENTS = 200;
const integer = z.number().int().nonnegative().safe();
const StateSchema = z
  .object({
    version: z.literal(1),
    day: integer,
    count: integer,
    recipients: z
      .array(
        z
          .object({
            key: z.string().regex(/^[a-f0-9]{64}$/),
            lastAt: integer,
            day: integer,
            dayCount: integer,
            hour: integer,
            hourCount: integer,
          })
          .strict(),
      )
      .max(MAX_RECIPIENTS),
  })
  .strict()
  .refine(
    (state) => new Set(state.recipients.map((item) => item.key)).size === state.recipients.length,
  );
type MailState = z.infer<typeof StateSchema>;

export interface AuthMailLimits {
  /** All account-mail purposes share the same daily allowance. */
  maxPerDay: number;
  recipientPerDay: number;
  recipientPerHour: number;
  recipientCooldownMs: number;
}
export const DEFAULT_AUTH_MAIL_LIMITS: Readonly<AuthMailLimits> = {
  maxPerDay: 100,
  recipientPerDay: 10,
  recipientPerHour: 3,
  recipientCooldownMs: MINUTE,
};

/** A single bounded ledger keeps recipient addresses and sign-in tokens out of storage. */
export class AuthMailBudget {
  private readonly limits: AuthMailLimits;
  constructor(
    private readonly storage: { sqlite?: Database.Database; pool?: pg.Pool },
    private readonly secret: string,
    limits: Partial<AuthMailLimits> = {},
    private readonly now = Date.now,
  ) {
    if (Boolean(storage.sqlite) === Boolean(storage.pool))
      throw new Error('One mail budget store is required.');
    this.limits = { ...DEFAULT_AUTH_MAIL_LIMITS, ...limits };
    for (const [key, value] of Object.entries(this.limits)) {
      const maximum = key === 'recipientCooldownMs' ? DAY : 10000;
      if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new Error('Account email limits must be bounded positive integers.');
    }
  }
  async init() {
    const state = JSON.stringify(this.initial());
    if (this.storage.sqlite) {
      this.storage.sqlite.exec(
        'CREATE TABLE IF NOT EXISTS elsewhere_auth_mail_budget (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
      );
      this.storage.sqlite
        .prepare('INSERT OR IGNORE INTO elsewhere_auth_mail_budget(id,payload) VALUES(1,?)')
        .run(state);
    } else {
      await this.storage.pool!.query(
        'CREATE TABLE IF NOT EXISTS elsewhere_auth_mail_budget (id INTEGER PRIMARY KEY CHECK(id=1), payload JSONB NOT NULL)',
      );
      await this.storage.pool!.query(
        'INSERT INTO elsewhere_auth_mail_budget(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING',
        [state],
      );
    }
  }
  private initial(): MailState {
    return { version: 1, day: Math.floor(this.now() / DAY), count: 0, recipients: [] };
  }
  private plan(input: unknown, email: string): { state: MailState; allowed: boolean } {
    const state = StateSchema.parse(input);
    const now = this.now(),
      day = Math.floor(now / DAY),
      hour = Math.floor(now / HOUR);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid mail budget clock.');
    // Clock rollback or an invalid saved ledger must never replenish a real allowance.
    if (day < state.day) return { state, allowed: false };
    if (day > state.day) {
      state.day = day;
      state.count = 0;
    }
    state.recipients = state.recipients.filter((item) => now - item.lastAt < DAY);
    const key = createHmac('sha256', this.secret)
      .update('elsewhere-auth-mail-v1\n' + email.trim().toLowerCase())
      .digest('hex');
    const previous = state.recipients.find((item) => item.key === key);
    if (
      state.count >= this.limits.maxPerDay ||
      (!previous && state.recipients.length >= MAX_RECIPIENTS) ||
      (previous &&
        (now - previous.lastAt < this.limits.recipientCooldownMs ||
          (previous.day === day && previous.dayCount >= this.limits.recipientPerDay) ||
          (previous.hour === hour && previous.hourCount >= this.limits.recipientPerHour)))
    )
      return { state, allowed: false };
    const next = {
      key,
      lastAt: now,
      day,
      dayCount: previous?.day === day ? previous.dayCount + 1 : 1,
      hour,
      hourCount: previous?.hour === hour ? previous.hourCount + 1 : 1,
    };
    state.recipients = [...state.recipients.filter((item) => item.key !== key), next];
    state.count++;
    return { state, allowed: true };
  }
  /** Reserve before sending. Delivery failures remain charged; no automatic retry sends extra mail. */
  async reserve(email: string): Promise<boolean> {
    if (this.storage.sqlite) {
      return this.storage.sqlite
        .transaction(() => {
          const row = this.storage
            .sqlite!.prepare('SELECT payload FROM elsewhere_auth_mail_budget WHERE id=1')
            .get() as { payload: string } | undefined;
          if (!row) throw new Error('Account mail ledger is unavailable.');
          const result = this.plan(JSON.parse(row.payload), email);
          this.storage
            .sqlite!.prepare('UPDATE elsewhere_auth_mail_budget SET payload=? WHERE id=1')
            .run(JSON.stringify(result.state));
          return result.allowed;
        })
        .immediate();
    }
    const client = await this.storage.pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='2000ms'");
      const rows = await client.query(
        'SELECT payload FROM elsewhere_auth_mail_budget WHERE id=1 FOR UPDATE',
      );
      if (rows.rowCount !== 1) throw new Error('Account mail ledger is unavailable.');
      const result = this.plan(rows.rows[0].payload, email);
      await client.query('UPDATE elsewhere_auth_mail_budget SET payload=$1::jsonb WHERE id=1', [
        JSON.stringify(result.state),
      ]);
      await client.query('COMMIT');
      return result.allowed;
    } catch {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error('Account mail ledger is unavailable.');
    } finally {
      client.release();
    }
  }
}
