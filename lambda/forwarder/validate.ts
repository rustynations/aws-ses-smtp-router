import type { RouterConfig } from './router';

export function validateConfig(config: RouterConfig): void {
  for (const [domain, domainConfig] of Object.entries(config.domains ?? {})) {
    for (const [address, value] of Object.entries(domainConfig.routes ?? {})) {
      const valid = value.includes('@') || value === 'bounce' || value === 'drop';
      if (!valid) {
        throw new Error(
          `Invalid route value for ${address} in ${domain}: "${value}" — must be an email address, "bounce", or "drop"`
        );
      }
    }
  }
}
