import type { ExpressionProvider } from '../packages/adapters/src/models/expression';
import { HUBERT_IDENTITY } from '../characters/hubert/src/persona';
import type { DecisionProvider } from '@elsewhere/character-runtime';
import { CompatibleDecisionProvider } from '../packages/adapters/src/models/compatible';
import { OllamaDecisionProvider } from '../packages/adapters/src/models/ollama';
import { RoutedDecisionProvider } from '../packages/adapters/src/models/routed';
import {
  ChatGPTClient,
  ChatGPTDecisionProvider,
  ChatGPTReflectionProvider,
  ChatGPTExpressionProvider,
} from '../packages/adapters/src/models/chatgpt';
import {
  BrokerModelClient,
  BrokerDecisionProvider,
  BrokerReflectionProvider,
  BrokerExpressionProvider,
} from '../packages/adapters/src/models/broker';
import {
  CompatibleReflectionProvider,
  OllamaReflectionProvider,
  RoutedReflectionProvider,
  type ReflectionProvider,
} from '../packages/adapters/src/models/reflection';
import { ChatGPTSession } from '../packages/security/src/chatgpt';
import { ChatGPTStore } from '../packages/security/src/chatgpt-store';
import { parseRoutingConfig } from '../packages/models/src/config';
import type { ModelBudgetPort, RoutingConfig } from '../packages/models/src/contracts';
import { resolve } from 'node:path';
import type { appConfig } from './config';
import { hubertInferenceBinding } from './residency';

/** All provider selection lives at the trusted host boundary, outside character definitions. */
export function runtimeProviders(
  config: ReturnType<typeof appConfig>,
  environment: NodeJS.ProcessEnv,
  ports: {
    onUsage(input: number, output: number): void;
    budgetFor(routing: RoutingConfig): ModelBudgetPort;
  },
): { model?: DecisionProvider; reflection?: ReflectionProvider; expression?: ExpressionProvider } {
  const common = { timeoutMs: config.MODEL_TIMEOUT_MS, onUsage: ports.onUsage };
  switch (config.MODEL_PROVIDER) {
    case 'local':
      return {};
    case 'broker': {
      const client = new BrokerModelClient({
        baseUrl: config.INFERENCE_BROKER_URL!,
        token: config.INFERENCE_BROKER_TOKEN!,
        caCertificate: config.INFERENCE_BROKER_CA_PEM?.replace(/\\n/g, '\n'),
        expectedBinding: hubertInferenceBinding(config.HUBERT_OWNER_USER_ID),
        timeoutMs: Math.max(35000, config.MODEL_TIMEOUT_MS),
        allowPrivateHttp: config.INFERENCE_BROKER_ALLOW_PRIVATE_HTTP === 'true',
        onUsage: ports.onUsage,
      });
      return {
        model: new BrokerDecisionProvider(client),
        reflection: new BrokerReflectionProvider(client),
        expression: new BrokerExpressionProvider(client),
      };
    }
    case 'chatgpt': {
      const client = new ChatGPTClient(
        new ChatGPTSession(
          new ChatGPTStore(resolve(config.CHATGPT_AUTH_ROOT ?? '.'), config.CHATGPT_PROFILE),
        ),
        { ...common, model: environment.MODEL_NAME ?? 'gpt-6-luna' },
      );
      return {
        model: new ChatGPTDecisionProvider(client),
        reflection: new ChatGPTReflectionProvider(client),
        expression: new ChatGPTExpressionProvider(client, HUBERT_IDENTITY),
      };
    }
    case 'ollama': {
      const options = {
        ...common,
        baseUrl: environment.OLLAMA_BASE_URL,
        model: environment.MODEL_NAME ?? 'qwen3:4b',
        timeoutMs: Math.max(30000, config.MODEL_TIMEOUT_MS),
      };
      return {
        model: new OllamaDecisionProvider(options),
        reflection: new OllamaReflectionProvider(options),
      };
    }
    case 'compatible': {
      const options = {
        ...common,
        baseUrl: environment.MODEL_BASE_URL ?? '',
        model: environment.MODEL_NAME ?? '',
        apiKey: environment.MODEL_API_KEY ?? '',
      };
      return {
        model: new CompatibleDecisionProvider(options),
        reflection: new CompatibleReflectionProvider(options),
      };
    }
    case 'routed': {
      const routing = parseRoutingConfig(environment.MODEL_ROUTING_JSON, config.production);
      let budget: ModelBudgetPort | undefined;
      const getBudget = () => (budget ??= ports.budgetFor(routing));
      const port: ModelBudgetPort = {
        reserve: (estimate) => getBudget().reserve(estimate),
        settle: (id, usage, failed) => getBudget().settle(id, usage, failed),
      };
      const options = { production: config.production };
      return {
        model: new RoutedDecisionProvider(routing, port, environment, options),
        reflection: routing.policies.reflection
          ? new RoutedReflectionProvider(routing, port, environment, options)
          : undefined,
      };
    }
  }
}
