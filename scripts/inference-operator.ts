import { parseArgs } from 'node:util';
import { isAbsolute } from 'node:path';
import { ChatGPTError, ChatGPTStore } from '../packages/security/src/chatgpt-store';
import {
  CHATGPT_TRANSFER_MAX_BYTES,
  chatGPTTransferStatus,
  importChatGPTTransfer,
} from '../packages/security/src/chatgpt-transfer';

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { profile: { type: 'string' } },
  });
  const root = process.env.INFERENCE_DATA_ROOT;
  const owner = process.env.HUBERT_OWNER_USER_ID;
  const profile = process.env.CHATGPT_PROFILE ?? 'default';
  if (
    !root ||
    !isAbsolute(root) ||
    !owner?.match(/^[a-zA-Z0-9_-]{1,128}$/) ||
    owner === 'local-owner' ||
    (values.profile !== undefined && values.profile !== profile) ||
    positionals.length !== 1
  )
    throw new ChatGPTError('invalid_broker_operator_configuration');
  const store = new ChatGPTStore(root, profile);
  if (positionals[0] === 'status') {
    console.log(JSON.stringify(chatGPTTransferStatus(store)));
    return;
  }
  if (positionals[0] !== 'import') throw new ChatGPTError('choose_import_or_status');
  let size = 0;
  const chunks: Buffer[] = [];
  const timeout = setTimeout(() => process.stdin.destroy(new Error('input_timeout')), 15_000);
  try {
    for await (const chunk of process.stdin) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > CHATGPT_TRANSFER_MAX_BYTES) throw new ChatGPTError('transfer_input_too_large');
      chunks.push(bytes);
    }
  } finally {
    clearTimeout(timeout);
  }
  let input: unknown;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ChatGPTError('invalid_transfer_input');
  }
  console.log(JSON.stringify(await importChatGPTTransfer(store, input, owner)));
}

main().catch((error) => {
  console.error(error instanceof ChatGPTError ? error.message : 'Broker operator command failed.');
  process.exitCode = 1;
});
