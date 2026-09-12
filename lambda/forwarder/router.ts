export interface RouterConfig {
  defaultForwardTo?: string;
  domains: Record<string, DomainConfig>;
  blockSenders?: Record<string, SenderBlockAction>;
  blockIps?: Record<string, SenderBlockAction>;
}

interface DomainConfig {
  catchAll?: string;
  routes?: Record<string, string>;
}

/** How to treat mail from a blocked sender. A block never forwards. */
export type SenderBlockAction = 'drop' | 'bounce' | 'spam';

export type RouteResult =
  | { action: 'forward'; to: string }
  | { action: 'drop' }
  | { action: 'bounce' }
  | { action: 'spam' };

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

/**
 * Decide whether mail from any of `senders` is blocked.
 *
 * `senders` is every address that claims to be the origin — the SES envelope
 * sender and the From header. Spam usually differs between the two, so a match
 * on either one blocks. Returns null when no pattern matches.
 *
 * Patterns, most specific first:
 *   "user@domain.tld" — that one address
 *   "domain.tld"      — that domain and its subdomains
 *   "*.tld"           — every domain under that suffix
 */
export function resolveSenderBlock(
  config: RouterConfig,
  senders: Array<string | undefined>
): RouteResult | null {
  const blockSenders = config.blockSenders;
  if (!blockSenders) return null;

  const addresses = senders
    .filter((sender): sender is string => typeof sender === 'string' && sender.includes('@'))
    .map((sender) => sender.trim().toLowerCase());
  if (addresses.length === 0) return null;

  const patterns = Object.entries(blockSenders).map(([pattern, action]) => ({
    pattern: pattern.trim().toLowerCase(),
    action,
  }));

  // Specificity order matters: an exact address entry must win over a broader
  // domain or wildcard entry that also covers it.
  for (const matches of [matchesAddress, matchesDomain, matchesSuffix]) {
    for (const { pattern, action } of patterns) {
      if (addresses.some((address) => matches(address, pattern))) {
        return { action };
      }
    }
  }

  return null;
}

/**
 * Decide whether mail from `ip` is blocked. A sender can register a new domain
 * in minutes but rarely changes address block, so one CIDR entry covers a whole
 * rotation that a domain list can only chase.
 *
 * Patterns: a single IPv4 address, or IPv4 CIDR ("151.247.171.0/24"). The
 * longest matching prefix wins, so a single address overrides a range that
 * contains it. IPv6 senders never match an IPv4 rule.
 */
export function resolveIpBlock(config: RouterConfig, ip: string): RouteResult | null {
  const blockIps = config.blockIps;
  if (!blockIps) return null;

  const address = ipToInt(ip);
  if (address === null) return null;

  let best: { prefix: number; action: SenderBlockAction } | undefined;

  for (const [pattern, action] of Object.entries(blockIps)) {
    const range = parseCidr(pattern);
    if (!range) continue;
    if ((address & range.mask) !== (range.network & range.mask)) continue;
    if (!best || range.prefix > best.prefix) best = { prefix: range.prefix, action };
  }

  return best ? { action: best.action } : null;
}

/** Parse an IPv4 address to a 32-bit number, or null if it is not one. */
export function ipToInt(ip: string): number | null {
  const octets = ip.trim().split('.');
  if (octets.length !== 4) return null;

  let value = 0;
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return null;
    const n = Number(octet);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

/** Parse "1.2.3.4" or "1.2.3.0/24", or null if it is neither. */
export function parseCidr(
  pattern: string
): { network: number; mask: number; prefix: number } | null {
  const [addressPart, prefixPart] = pattern.trim().split('/');

  const network = ipToInt(addressPart);
  if (network === null) return null;

  let prefix = 32;
  if (prefixPart !== undefined) {
    if (!/^\d{1,2}$/.test(prefixPart)) return null;
    prefix = Number(prefixPart);
    if (prefix > 32) return null;
  }

  // A /0 mask must be 0, which the shift below cannot express directly.
  const mask = prefix === 0 ? 0 : (-1 << (32 - prefix)) >>> 0;
  return { network, mask, prefix };
}

function domainOf(address: string): string {
  return address.substring(address.lastIndexOf('@') + 1);
}

function matchesAddress(address: string, pattern: string): boolean {
  return pattern.includes('@') && address === pattern;
}

function matchesDomain(address: string, pattern: string): boolean {
  if (pattern.includes('@') || pattern.startsWith('*.')) return false;
  const domain = domainOf(address);
  return domain === pattern || domain.endsWith(`.${pattern}`);
}

function matchesSuffix(address: string, pattern: string): boolean {
  if (!pattern.startsWith('*.')) return false;
  return domainOf(address).endsWith(pattern.substring(1));
}
