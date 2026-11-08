import 'dotenv/config';
import { OllamaDecisionProvider } from '../packages/adapters/src/models/ollama';
const provider = new OllamaDecisionProvider({
  baseUrl: process.env.OLLAMA_BASE_URL,
  model: process.env.MODEL_NAME ?? 'qwen3:4b',
  timeoutMs: 30000,
});
const health = await provider.health();
if (!health.available) {
  console.error(
    `Ollama is running but ${health.model} is not installed. Run: ollama pull ${health.model}`,
  );
  process.exit(1);
}
const started = performance.now();
const action = await provider.propose({
  identity: 'Hubert',
  state: { energy: 15, mood: 60 },
  intentions: ['Recover before exploring'],
  memories: [],
  observations: { description: 'Hubert is sitting safely on a bench. Rest is available.' },
  outsideMessages: [],
});
console.log(
  JSON.stringify(
    {
      model: health.model,
      action,
      milliseconds: Math.round(performance.now() - started),
      paidRequests: 0,
    },
    null,
    2,
  ),
);
