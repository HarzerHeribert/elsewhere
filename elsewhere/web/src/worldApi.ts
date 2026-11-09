import type {
  AccountResponse,
  PublicSnapshot,
  ProviderIssue,
} from '@elsewhere/character-interfaces';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The deadline covers the response body as well as the initial connection. */
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  let rejectAbort!: (reason: unknown) => void;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    const error =
      init.signal?.reason ?? new Error('The request was interrupted. Please try again.');
    controller.abort(error);
    rejectAbort(error);
  };
  init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    const error = new Error('The request timed out. Please try again.');
    controller.abort(error);
    rejectAbort(error);
  }, timeoutMs);
  if (init.signal?.aborted) abort();
  try {
    return await Promise.race([
      interrupted,
      (async () => {
        const response = await fetch(url, {
          credentials: 'same-origin',
          ...init,
          signal: controller.signal,
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            data?.message ?? (typeof data?.error === 'string' ? data.error : data?.error?.message);
          throw new ApiError(
            typeof message === 'string' ? message : 'The server could not complete this request.',
            response.status,
          );
        }
        if (data === null)
          throw new Error('The server returned an invalid response. Please try again.');
        return data as T;
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

export async function getWorldSnapshot(signal: AbortSignal): Promise<PublicSnapshot> {
  const value = await requestJson<PublicSnapshot>('/api/world', { cache: 'no-store', signal });
  if (
    !value?.world?.bounds ||
    !Array.isArray(value.world.residents) ||
    !Array.isArray(value.world.places) ||
    !Array.isArray(value.world.objects) ||
    !Array.isArray(value.world.obstacles) ||
    !value.character ||
    !value.runtime ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.memories)
  ) {
    throw new Error('The world response is incomplete. Reconnecting shortly.');
  }
  return value;
}

export async function getAccount(signal: AbortSignal): Promise<AccountResponse> {
  const value = await requestJson<AccountResponse>('/api/account', { cache: 'no-store', signal });
  if (typeof value?.enabled !== 'boolean')
    throw new Error('The account service returned an invalid response.');
  const managedCharacterIds =
    value.user && Array.isArray(value.managedCharacterIds)
      ? value.managedCharacterIds.filter(
          (id): id is string =>
            typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id),
        )
      : [];
  const characterIssues = Array.isArray(value.characterIssues)
    ? value.characterIssues
        .filter(
          (issue): issue is ProviderIssue =>
            !!issue &&
            managedCharacterIds.includes(issue.characterId) &&
            typeof issue.id === 'string' &&
            typeof issue.message === 'string' &&
            ['unconfigured', 'unavailable', 'failed', 'allowance'].includes(issue.kind) &&
            Number.isFinite(issue.since) &&
            Number.isFinite(issue.lastAt) &&
            (issue.resolvedAt === undefined || Number.isFinite(issue.resolvedAt)) &&
            (issue.workload === undefined ||
              ['decision', 'notebook', 'reflection'].includes(issue.workload)),
        )
        .slice(-16)
    : [];
  return {
    user: value.user ?? null,
    enabled: value.enabled,
    passwordAuthEnabled: value.passwordAuthEnabled === true,
    requiresEmailVerification: value.requiresEmailVerification === true,
    managedCharacterIds,
    characterIssues,
  };
}
