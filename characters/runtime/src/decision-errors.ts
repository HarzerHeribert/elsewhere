import type { CharacterCommand } from '../../interfaces/src/commands';

/** Host-authored diagnostics only. Never retain provider bodies or private prompt content. */
export class InvalidDecisionError extends Error {
  constructor(
    readonly code: 'invalid_json' | 'invalid_action' | 'unavailable_action',
    readonly fields: DecisionDiagnosticField[] = [],
    readonly command?: CharacterCommand,
    message = 'The model reply did not match an allowed action. Use the offered action format.',
  ) {
    super(message);
  }
}

export const DECISION_DIAGNOSTIC_FIELDS = [
  'type',
  'targetId',
  'control',
  'value',
  'position',
  'x',
  'z',
  'durationMs',
  'duration',
  'durationSeconds',
  'sourceId',
  'question',
  'why',
  'pursuitId',
  'query',
  'surprised',
  'next',
  'sourceIds',
  'task',
  'text',
  'action',
  'command',
  'reason',
  'explanation',
  'thought',
  'thoughts',
  'args',
  'parameters',
  'target',
  'other',
] as const;
export type DecisionDiagnosticField = (typeof DECISION_DIAGNOSTIC_FIELDS)[number];
const diagnosticFields = new Set<string>(DECISION_DIAGNOSTIC_FIELDS);

export function invalidDecisionFields(error: unknown): DecisionDiagnosticField[] {
  const issues = (error as { issues?: Array<{ path?: unknown[]; keys?: unknown[] }> })?.issues;
  if (!Array.isArray(issues)) return [];
  return [
    ...new Set(
      issues
        .flatMap((issue) => [...(issue.path ?? []), ...(issue.keys ?? [])])
        .filter((key): key is string => typeof key === 'string')
        .map((key) => (diagnosticFields.has(key) ? (key as DecisionDiagnosticField) : 'other')),
    ),
  ].slice(0, 8);
}
