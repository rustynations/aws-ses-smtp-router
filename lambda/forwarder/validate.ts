import { parseCidr, type RouterConfig, type SenderBlockAction } from './router';

const SENDER_BLOCK_ACTIONS: SenderBlockAction[] = ['drop', 'bounce', 'spam'];

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

  for (const [pattern, action] of Object.entries(config.blockSenders ?? {})) {
    if (!pattern.trim()) {
      throw new Error('Invalid blockSenders entry: the sender pattern must not be empty');
    }
    // A block never forwards, so an email address here is a mistake, not a target.
    if (!SENDER_BLOCK_ACTIONS.includes(action)) {
      throw new Error(
        `Invalid blockSenders action for ${pattern}: "${action}" — must be "drop", "bounce", or "spam"`
      );
    }
  }

  for (const [pattern, action] of Object.entries(config.blockIps ?? {})) {
    // A pattern we cannot parse would silently never match, so reject it here.
    if (!parseCidr(pattern)) {
      throw new Error(
        `Invalid blockIps pattern "${pattern}" — must be an IPv4 address or CIDR range, e.g. "151.247.171.0/24"`
      );
    }
    if (!SENDER_BLOCK_ACTIONS.includes(action)) {
      throw new Error(
        `Invalid blockIps action for ${pattern}: "${action}" — must be "drop", "bounce", or "spam"`
      );
    }
  }
}
