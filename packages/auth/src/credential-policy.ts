import type Database from 'better-sqlite3';
import type pg from 'pg';

type Operation =
  | { type: 'policy'; required: boolean }
  | { type: 'delete'; id: string }
  | { type: 'recover' };
interface Row {
  ownerControlsRequirePasskey: boolean | number | null;
  role: string | null;
  banned: boolean | number | null;
}
export class CredentialPolicyError extends Error {
  constructor(
    readonly status: 403 | 404,
    message: string,
  ) {
    super(message);
  }
}
function check(user: Row | undefined, count: number, operation: Operation, fresh: boolean) {
  if (!user) throw new CredentialPolicyError(404, 'Account not found.');
  const required =
    user.ownerControlsRequirePasskey === true || user.ownerControlsRequirePasskey === 1;
  if (operation.type === 'recover') {
    if (!user.role?.split(',').includes('admin') || user.banned)
      throw new CredentialPolicyError(
        403,
        'Private recovery requires an existing active world operator.',
      );
  } else if (operation.type === 'policy') {
    if (!fresh || count < 1)
      throw new CredentialPolicyError(
        403,
        'Sign in with a passkey, then change this setting within five minutes.',
      );
  } else if (required && (!fresh || count <= 1)) {
    throw new CredentialPolicyError(
      403,
      count <= 1
        ? 'Turn off passkey protection before removing the last passkey.'
        : 'Verify a passkey to change protected sign-in methods.',
    );
  }
}
/** Per-user row locks serialize policy changes and deletions across processes. No HTTP recovery path. */
export async function mutateCredentialPolicy(
  storage: { sqlite?: Database.Database; pool?: pg.Pool },
  userId: string,
  operation: Operation,
  fresh: boolean,
) {
  if (storage.sqlite) {
    storage.sqlite
      .transaction(() => {
        const user = storage
          .sqlite!.prepare(
            'SELECT ownerControlsRequirePasskey,role,banned FROM elsewhere_auth_user WHERE id=?',
          )
          .get(userId) as Row | undefined;
        const count = (
          storage
            .sqlite!.prepare('SELECT COUNT(*) AS n FROM elsewhere_auth_passkey WHERE userId=?')
            .get(userId) as { n: number }
        ).n;
        check(user, count, operation, fresh);
        if (operation.type === 'policy')
          storage
            .sqlite!.prepare(
              'UPDATE elsewhere_auth_user SET ownerControlsRequirePasskey=?,updatedAt=? WHERE id=?',
            )
            .run(operation.required ? 1 : 0, Date.now(), userId);
        else if (operation.type === 'delete') {
          const result = storage
            .sqlite!.prepare('DELETE FROM elsewhere_auth_passkey WHERE id=? AND userId=?')
            .run(operation.id, userId);
          if (result.changes !== 1) throw new CredentialPolicyError(404, 'Passkey not found.');
        } else {
          storage.sqlite!.prepare('DELETE FROM elsewhere_auth_session WHERE userId=?').run(userId);
          storage.sqlite!.prepare('DELETE FROM elsewhere_auth_passkey WHERE userId=?').run(userId);
          storage
            .sqlite!.prepare(
              'UPDATE elsewhere_auth_user SET ownerControlsRequirePasskey=0,updatedAt=? WHERE id=?',
            )
            .run(Date.now(), userId);
        }
      })
      .immediate();
    return;
  }
  const client = await storage.pool!.connect();
  let destroy = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout='2000ms'");
    const rows = await client.query(
      'SELECT "ownerControlsRequirePasskey",role,banned FROM elsewhere_auth_user WHERE id=$1 FOR UPDATE',
      [userId],
    );
    const count = await client.query(
      'SELECT COUNT(*) AS n FROM elsewhere_auth_passkey WHERE "userId"=$1',
      [userId],
    );
    check(rows.rows[0], Number(count.rows[0].n), operation, fresh);
    if (operation.type === 'policy')
      await client.query(
        'UPDATE elsewhere_auth_user SET "ownerControlsRequirePasskey"=$1,"updatedAt"=$2 WHERE id=$3',
        [operation.required, new Date(), userId],
      );
    else if (operation.type === 'delete') {
      const result = await client.query(
        'DELETE FROM elsewhere_auth_passkey WHERE id=$1 AND "userId"=$2',
        [operation.id, userId],
      );
      if (result.rowCount !== 1) throw new CredentialPolicyError(404, 'Passkey not found.');
    } else {
      await client.query('DELETE FROM elsewhere_auth_session WHERE "userId"=$1', [userId]);
      await client.query('DELETE FROM elsewhere_auth_passkey WHERE "userId"=$1', [userId]);
      await client.query(
        'UPDATE elsewhere_auth_user SET "ownerControlsRequirePasskey"=false,"updatedAt"=$1 WHERE id=$2',
        [new Date(), userId],
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      destroy = true;
    });
    if (error instanceof CredentialPolicyError) throw error;
    throw new Error('Account security storage is unavailable.');
  } finally {
    client.release(destroy);
  }
}
