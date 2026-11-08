import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import {
  credentialSchemas,
  CredentialServiceSchema,
  CredentialStoreError,
  loadCredentialProfile,
  saveCredentialProfile,
} from '../packages/security/src/credential-store';
import { createSetupPrompter } from './setup-prompts';

const root = fileURLToPath(new URL('../', import.meta.url));
const descriptions = {
  model: 'Cloud model — used only when you explicitly run pnpm dev:configured.',
  stripe: 'Stripe sandbox — saved for the future adapter; no payment endpoint is connected.',
  email: 'Resend — saved for the future adapter; no email will be sent.',
};

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      options: { character: { type: 'string', default: 'hubert' }, help: { type: 'boolean' } },
      allowPositionals: true,
    });
  } catch {
    throw new CredentialStoreError(
      'Unknown option. Keys belong in hidden prompts, never command arguments. Run pnpm run setup help.',
    );
  }
  const character = parsed.values.character!;
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(character))
    throw new CredentialStoreError(
      'Character IDs must use lowercase letters, numbers and hyphens.',
    );
  if (parsed.positionals.length > 1)
    throw new CredentialStoreError(
      'Choose one setup command. Never pass credentials as arguments.',
    );
  let command = parsed.positionals[0];
  if (parsed.values.help || command === 'help') {
    console.log(
      'pnpm run setup [model|stripe|email|status|guide] [--character hubert]\n\nKeys are entered privately in a terminal. No keys are sent over the network by setup.\nStored locally in .data/credentials/<character>/<service>.json with private file permissions.\nStripe/email are staged only. Model use requires pnpm dev:configured (Hubert only).\nNo live Stripe keys, personal access tokens or cloud administrator keys are needed.',
    );
    return;
  }
  if (command === 'guide') {
    const path = fileURLToPath(new URL('../docs/setup/index.html', import.meta.url));
    console.log(`Setup guide: ${path}`);
    if (process.platform === 'darwin') {
      const child = spawn('open', [path], { stdio: 'ignore' });
      child.on('error', () => console.log('Open the HTML file in a browser.'));
    }
    return;
  }
  if (command === 'status') {
    for (const service of CredentialServiceSchema.options) {
      try {
        const record = loadCredentialProfile(root, character, service);
        console.log(
          `${service}: ${record ? 'saved locally; not provider-verified' : 'not configured'}`,
        );
      } catch {
        console.log(`${service}: unsafe or invalid local storage; no values displayed`);
      }
    }
    console.log('Model needs explicit launch. Stripe/email adapters are not connected.');
    return;
  }
  const prompts = createSetupPrompter();
  const ask = prompts.ask;
  async function field<T>(
    label: string,
    schema: z.ZodType<T>,
    privateInput = false,
    fallback?: string,
  ): Promise<T> {
    for (;;) {
      const value = await ask(label, privateInput);
      const result = schema.safeParse(value || fallback || '');
      if (result.success) return result.data;
      console.log(
        'That value does not match this field. Nothing was saved; try again or press Ctrl+C.',
      );
    }
  }
  try {
    if (!command) {
      console.log(
        'Elsewhere / private local setup\nNo keys are required for pnpm dev or pnpm dev:ollama.\nChoose model, stripe or email. Ctrl+C cancels without saving.',
      );
      command = await ask('Service');
    }
    const service = CredentialServiceSchema.safeParse(command);
    if (!service.success)
      throw new CredentialStoreError('Choose model, stripe, email, status or guide.');
    console.log(descriptions[service.data]);
    const current = loadCredentialProfile(root, character, service.data);
    if (current && (await ask('Replace the existing settings? Type replace')) !== 'replace') {
      console.log('Cancelled. Existing settings were kept.');
      return;
    }
    let values;
    if (service.data === 'model') {
      console.log(
        'Choose a trusted chat-completions endpoint. On explicit launch it may receive private visitor notes.\nSet a provider-side spending limit too; request counts are not a dollar cap.',
      );
      values = {
        baseUrl: await field(
          'Base URL (HTTPS; include /v1 if required)',
          credentialSchemas.model.shape.baseUrl,
        ),
        model: await field('Model identifier', credentialSchemas.model.shape.model),
        apiKey: await field('Provider API key', credentialSchemas.model.shape.apiKey, true),
        maxCallsPerDay: await field(
          'Maximum requests per day [20]',
          z.coerce.number().int().min(1).max(1000),
          false,
          '20',
        ),
      };
    } else if (service.data === 'stripe') {
      console.log(
        'Use a dedicated Stripe sandbox and a restricted rk_test_ key. Full-access and live keys are rejected.\nWebhook secret is optional until an endpoint exists.',
      );
      const restrictedKey = await field(
        'Sandbox restricted API key',
        credentialSchemas.stripe.shape.restrictedKey,
        true,
      );
      const webhookSecret = await field(
        'Webhook signing secret (Enter to skip)',
        credentialSchemas.stripe.shape.webhookSecret.unwrap().or(z.literal('')),
        true,
      );
      values = { restrictedKey, ...(webhookSecret ? { webhookSecret } : {}) };
    } else {
      console.log(
        'Use a Resend Sending access key limited to the verified sender domain.\nThe prefix cannot prove its scope: check the provider dashboard yourself.',
      );
      values = {
        apiKey: await field('Resend sending API key', credentialSchemas.email.shape.apiKey, true),
        fromAddress: await field(
          'Verified sender email address',
          credentialSchemas.email.shape.fromAddress,
        ),
      };
    }
    // The selected schema validates the entire record again at the storage boundary.
    saveCredentialProfile(root, character, service.data, values, { replace: Boolean(current) });
    console.log(
      `Saved privately for ${character}/${service.data}. No credential value was printed or sent.`,
    );
    console.log(
      service.data === 'model'
        ? 'To use it for Hubert: pnpm dev:configured. Ordinary pnpm dev is unchanged.'
        : 'Staged only. No adapter, permission grant, webhook or external action was enabled.',
    );
  } finally {
    prompts.close();
  }
}

main().catch((error) => {
  console.error(
    error instanceof CredentialStoreError
      ? error.message
      : 'Setup stopped without displaying credentials. No provider request was made.',
  );
  process.exitCode = 1;
});
