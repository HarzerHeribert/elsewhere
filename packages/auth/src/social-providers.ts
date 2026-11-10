export const SOCIAL_PROVIDER_IDS = ['github', 'google'] as const;
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number];
export interface SocialProviderCredentials {
  clientId: string;
  clientSecret: string;
}
export type SocialProviderConfiguration = Partial<
  Record<SocialProviderId, SocialProviderCredentials>
>;
export const SOCIAL_IDENTITY_SCOPES: Readonly<Record<SocialProviderId, readonly string[]>> = {
  github: ['read:user', 'user:email'],
  google: ['openid', 'email', 'profile'],
};
function valid(value: unknown, maximum: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maximum &&
    !/[\r\n\0]/.test(value)
  );
}
export function socialProvidersFromEnvironment(
  environment: NodeJS.ProcessEnv,
): SocialProviderConfiguration {
  const providers: SocialProviderConfiguration = {};
  for (const id of SOCIAL_PROVIDER_IDS) {
    const prefix = 'AUTH_' + id.toUpperCase();
    const clientId = environment[prefix + '_CLIENT_ID'],
      clientSecret = environment[prefix + '_CLIENT_SECRET'];
    if (clientId === undefined && clientSecret === undefined) continue;
    if (!valid(clientId, 255) || !valid(clientSecret, 4096))
      throw new Error(
        `Account sign-in requires a complete ${id} client ID and client secret pair.`,
      );
    providers[id] = { clientId, clientSecret };
  }
  return providers;
}
/** Fixed login scopes cannot be reused as character service authorization. */
export function socialProviderOptions(providers: SocialProviderConfiguration = {}) {
  for (const [id, pair] of Object.entries(providers))
    if (
      !(SOCIAL_PROVIDER_IDS as readonly string[]).includes(id) ||
      !pair ||
      !valid(pair.clientId, 255) ||
      !valid(pair.clientSecret, 4096)
    )
      throw new Error('Account sign-in provider configuration is invalid.');
  return {
    ...(providers.github
      ? {
          github: {
            ...providers.github,
            disableDefaultScope: true,
            scope: [...SOCIAL_IDENTITY_SCOPES.github],
          },
        }
      : {}),
    ...(providers.google
      ? {
          google: {
            ...providers.google,
            disableDefaultScope: true,
            scope: [...SOCIAL_IDENTITY_SCOPES.google],
            includeGrantedScopes: false,
          },
        }
      : {}),
  };
}
