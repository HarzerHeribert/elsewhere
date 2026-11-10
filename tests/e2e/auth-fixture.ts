import type { APIRequestContext, APIResponse } from '@playwright/test';

/** Security browser cases share one server; honor its real admission budget between fixtures. */
export async function createFixtureAccount(
  request: APIRequestContext,
  origin: string,
  details: { name: string; email: string; password: string },
): Promise<APIResponse> {
  const deadline = Date.now() + 70000;
  for (;;) {
    const response = await request.post('/api/auth/sign-up/email', {
      headers: { origin },
      data: details,
    });
    if (response.status() !== 429 || Date.now() >= deadline) return response;
    const after = Number(response.headers()['retry-after']);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(5000, Math.max(1000, Number.isFinite(after) ? after * 1000 : 2000)),
      ),
    );
  }
}
