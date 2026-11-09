import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { ChatGPTError, ChatGPTStore } from '../packages/security/src/chatgpt-store';
import { beginChatGPTSignIn, ChatGPTSession } from '../packages/security/src/chatgpt';
import { ChatGPTClient, ChatGPTDecisionProvider } from '../packages/adapters/src/models/chatgpt';
import {
  chatGPTTransferStatus,
  transferChatGPTSession,
} from '../packages/security/src/chatgpt-transfer';
import type { ControllerState } from '../app/controller';

// No dotenv or Codex credential discovery. Only this app's explicitly selected registration.
const root = fileURLToPath(new URL('../', import.meta.url));
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      profile: { type: 'string', default: 'default' },
      model: { type: 'string', default: 'gpt-6-luna' },
      'no-browser': { type: 'boolean' },
      destination: { type: 'string' },
      'owner-user-id': { type: 'string' },
    },
  });
  if (positionals.length !== 1)
    throw new ChatGPTError('choose_login_status_models_check_resume_logout_or_transfer');
  const session = new ChatGPTSession(new ChatGPTStore(root, values.profile));
  const client = new ChatGPTClient(session, { model: values.model, timeoutMs: 30000 });
  switch (positionals[0]) {
    case 'login': {
      console.log(
        'Elsewhere / Continue with ChatGPT\nAuthorize your own account and plan usage in the browser. No API key or Codex login is used.',
      );
      const attempt = await beginChatGPTSignIn(session);
      const cancel = () => attempt.cancel();
      process.once('SIGINT', cancel);
      process.once('SIGTERM', cancel);
      // No id_token_hint is included, so this link contains no retained account token.
      console.log(`Continue with ChatGPT: ${attempt.url}`);
      if (!values['no-browser']) {
        const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
        const browser = spawn(command, [attempt.url], { stdio: 'ignore' });
        browser.on('error', () => console.log('Open the displayed link in your system browser.'));
      }
      try {
        await attempt.completion;
      } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', cancel);
      }
      console.log(
        session.isAvailable()
          ? 'Connected. Next: pnpm chatgpt models, then pnpm chatgpt check. No inference has run yet.'
          : 'Signed in, but plan usage was not granted. Inference remains disabled.',
      );
      return;
    }
    case 'status': {
      const account = session.store.load();
      console.log(
        JSON.stringify(
          {
            profile: values.profile,
            account: account?.email ?? (account ? 'saved account' : null),
            signedIn: !!account?.tokens,
            planPermission: !!account?.tokens?.scopes.includes('chatgpt.tokens.use.direct'),
            requestsEnabled: session.isAvailable(),
            pausedReason: account?.pause?.code ?? null,
            transfer: chatGPTTransferStatus(session.store).transfer,
            usageSettings: 'https://chatgpt.com/settings/usage',
          },
          null,
          2,
        ),
      );
      return;
    }
    case 'models':
      console.log(JSON.stringify(await client.models(), null, 2));
      return;
    case 'transfer': {
      if (!values.destination || !values['owner-user-id'])
        throw new ChatGPTError('transfer_requires_destination_and_owner_user_id');
      const result = await transferChatGPTSession(session.store, {
        destination: values.destination,
        ownerUserId: values['owner-user-id'],
      });
      console.log(
        JSON.stringify({
          transferId: result.transferId,
          profile: result.profile,
          delegated: true,
          localRequestsEnabled: false,
        }),
      );
      return;
    }
    case 'resume':
      await session.resume();
      console.log('Local pause cleared. Provider-side limits still apply.');
      return;
    case 'logout':
      console.log(
        (await session.signOut())
          ? 'Signed out; remote renewable session revoked.'
          : 'Signed out locally; remote revocation was not confirmed. Disconnect Elsewhere in ChatGPT Settings.',
      );
      return;
    case 'check': {
      // Import the world only for this command; setup never opens the lived database.
      const { ElsewhereController } = await import('../app/controller');
      const { SqliteSnapshotStore } = await import('../packages/persistence/src/index');
      const model = new ChatGPTDecisionProvider(client);
      let action: unknown,
        dispatched = false;
      let failure: unknown;
      const controller = await new ElsewhereController(
        new SqliteSnapshotStore<ControllerState>(':memory:'),
        {
          modelMaximum: 1,
          modelProvider: {
            id: model.id,
            isAvailable: () => model.isAvailable(),
            propose: async (context) => {
              dispatched = true;
              try {
                action = await model.propose(context);
                return action;
              } catch (error) {
                failure = error;
                throw error;
              }
            },
          },
        },
      ).init();
      const started = performance.now();
      try {
        const result = await controller.step();
        console.log(
          JSON.stringify(
            {
              model: client.model,
              isolated: true,
              dispatched,
              completed: !!action,
              action: action ?? null,
              activity: result.character.activity,
              modelStatus: result.runtime.modelStatus,
              reservedCalls: result.runtime.modelCalls,
              milliseconds: Math.round(performance.now() - started),
              apiKeyBillingFallback: false,
            },
            null,
            2,
          ),
        );
        if (!action) {
          if (failure instanceof ChatGPTError && failure.diagnostics)
            console.error(JSON.stringify(failure.diagnostics));
          throw new ChatGPTError(session.store.load()?.pause?.code ?? 'no_validated_model_action');
        }
      } finally {
        await controller.close();
      }
      return;
    }
    default:
      throw new ChatGPTError('choose_login_status_models_check_resume_logout_or_transfer');
  }
}
main().catch((error) => {
  console.error(
    error instanceof ChatGPTError
      ? error.message
      : 'ChatGPT setup failed; no credential values were displayed.',
  );
  process.exitCode = 1;
});
