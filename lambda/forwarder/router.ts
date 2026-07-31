export interface RouterConfig {
  defaultForwardTo?: string;
  domains: Record<string, DomainConfig>;
}

interface DomainConfig {
  catchAll?: string;
  routes?: Record<string, string>;
}

export type RouteResult =
  | { action: 'forward'; to: string }
  | { action: 'drop' }
  | { action: 'bounce' };

function toResult(value: string): RouteResult {
  if (value === 'bounce') return { action: 'bounce' };
  if (value === 'drop') return { action: 'drop' };
  return { action: 'forward', to: value };
}

export function resolveRoute(config: RouterConfig, recipient: string): RouteResult {
  const normalizedRecipient = recipient.toLowerCase();
  const atIndex = normalizedRecipient.lastIndexOf('@');
  const domain = atIndex === -1 ? '' : normalizedRecipient.substring(atIndex + 1);
  const domainConfig = domain ? config.domains[domain] : undefined;

  const exact = domainConfig?.routes?.[normalizedRecipient];
  if (exact !== undefined) return toResult(exact);

  if (domainConfig?.catchAll) return { action: 'forward', to: domainConfig.catchAll };

  if (config.defaultForwardTo) return { action: 'forward', to: config.defaultForwardTo };

  return { action: 'drop' };
}
