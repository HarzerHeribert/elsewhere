import {
  CharacterDecisionSchema,
  narrowActionFormat,
  type CharacterDecision,
} from '@elsewhere/character-interfaces';
import type { DecisionContext, DecisionProvider } from '@elsewhere/character-runtime';
import {
  ModelExecutionError,
  type ModelBudgetPort,
  type ModelUsage,
  type RoutingConfig,
} from '../../../models/src/contracts';
import { parseRoutingConfig } from '../../../models/src/config';
import { WorkloadRouter } from '../../../models/src/router';
import { CompatibleDecisionProvider } from './compatible';
import { OllamaDecisionProvider } from './ollama';
import { DECISION_PROMPT_VERSION, decisionMessages } from './shared';

/** The shared router supports other job consumers; this adapter only proposes world actions. */
export class RoutedDecisionProvider implements DecisionProvider<CharacterDecision> {
  readonly id = 'routed';
  readonly managesAllowance = true;
  readonly localOnly: boolean;
  readonly router: WorkloadRouter;
  readonly config: RoutingConfig;
  private readonly keys = new Map<string, string>();
  constructor(
    input: RoutingConfig,
    budget: ModelBudgetPort,
    environment: NodeJS.ProcessEnv,
    options: { production?: boolean; fetcher?: typeof fetch; now?: () => number } = {},
  ) {
    this.options = options;
    this.config = parseRoutingConfig(input, options.production);
    if (!this.config.policies.decision)
      throw new Error('Routed decisions require a decision workload policy.');
    this.localOnly = this.config.policies.decision.models.every(
      (id) => this.config.profiles.find((profile) => profile.id === id)!.local,
    );
    for (const profile of this.config.profiles) {
      if (!this.config.policies.decision.models.includes(profile.id)) continue;
      if (profile.transport === 'compatible' && profile.apiKeyEnv) {
        const key = environment[profile.apiKeyEnv];
        if (!key) throw new Error('A configured model credential is missing.');
        this.keys.set(profile.id, key);
      }
    }
    this.router = new WorkloadRouter(this.config, budget, options.now);
  }
  private readonly options: { production?: boolean; fetcher?: typeof fetch; now?: () => number };
  async propose(context: DecisionContext): Promise<CharacterDecision> {
    const messages = decisionMessages(context);
    const result = await this.router.run(
      {
        workload: 'decision',
        input: { messages, format: narrowActionFormat(context.choices) },
        prefix: messages[0].content,
        promptVersion: DECISION_PROMPT_VERSION,
        validationVersion: 'character-decision-v1',
        privacy: this.config.allowRemote ? 'remote-allowed' : 'local-only',
        audience: 'character-private',
      },
      async (execution) => {
        let usage: ModelUsage | undefined;
        const common = {
          messages: (execution.input as { messages: ReturnType<typeof decisionMessages> }).messages,
          baseUrl: execution.profile.baseUrl,
          model: execution.profile.model,
          signal: execution.signal,
          timeoutMs: this.config.policies.decision!.maxLatencyMs,
          maxOutputTokens: execution.maxOutputTokens,
          onUsageDetails: (reported: ModelUsage | undefined) => {
            usage = reported;
          },
          fetcher: this.options.fetcher,
        };
        const provider =
          execution.profile.transport === 'ollama'
            ? new OllamaDecisionProvider({
                ...common,
                contextTokens: execution.profile.contextTokens,
              })
            : new CompatibleDecisionProvider({
                ...common,
                apiKey: this.keys.get(execution.profile.id)!,
                promptCacheKey: execution.promptCacheKey,
                sessionAffinity: execution.sessionAffinity,
                cloudflareGateway: execution.profile.gateway === 'cloudflare',
              });
        try {
          return { value: await provider.propose(context), usage };
        } catch {
          throw new ModelExecutionError(usage);
        }
      },
      (value) => CharacterDecisionSchema.parse(value),
    );
    return result.value;
  }
}
