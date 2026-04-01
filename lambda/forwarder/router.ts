export interface RouterConfig {
  defaultForwardTo?: string;
  domains: Record<string, DomainConfig>;
}

interface DomainConfig {
  catchAll?: string;
  routes?: Record<string, string>;
}

export function resolveRoute(config: RouterConfig, recipient: string): string | null {
  const normalizedRecipient = recipient.toLowerCase();
  const atIndex = normalizedRecipient.lastIndexOf('@');
  if (atIndex === -1) {
    return config.defaultForwardTo ?? null;
  }

  const domain = normalizedRecipient.substring(atIndex + 1);
  const domainConfig = config.domains[domain];

  if (!domainConfig) {
    return config.defaultForwardTo ?? null;
  }

  if (domainConfig.routes?.[normalizedRecipient]) {
    return domainConfig.routes[normalizedRecipient];
  }

  if (domainConfig.catchAll) {
    return domainConfig.catchAll;
  }

  return config.defaultForwardTo ?? null;
}
