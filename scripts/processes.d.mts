export interface ServiceSpecification {
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}
export function runServices(
  specifications: ServiceSpecification[],
  options?: { env?: NodeJS.ProcessEnv; graceMs?: number },
): { stop(code?: number): Promise<void>; completion: Promise<number> };
