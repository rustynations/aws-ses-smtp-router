import { validateConfig } from '../../lambda/forwarder/validate';
import type { RouterConfig } from '../../lambda/forwarder/router';

describe('validateConfig', () => {
  test('accepts forward, bounce, and drop values', () => {
    const config: RouterConfig = {
      domains: {
        'routy.com': {
          catchAll: 'catch@gmail.com',
          routes: {
            'sales@routy.com': 'sales@gmail.com',
            'dennis@routy.com': 'bounce',
            'spam-magnet@routy.com': 'drop',
          },
        },
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('rejects a route value that is neither an address nor bounce/drop', () => {
    const config: RouterConfig = {
      domains: {
        'routy.com': { routes: { 'dennis@routy.com': 'bunce' } },
      },
    };
    expect(() => validateConfig(config)).toThrow(/dennis@routy.com/);
  });

  test('does not require routes to be present', () => {
    const config: RouterConfig = { domains: { 'routy.com': { catchAll: 'catch@gmail.com' } } };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('accepts drop, bounce, and spam as blockSenders actions', () => {
    const config: RouterConfig = {
      domains: {},
      blockSenders: {
        'acetoois@contexttable.skin': 'spam',
        'quiet.example': 'drop',
        'gone.example': 'bounce',
        '*.skin': 'drop',
      },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('rejects a blockSenders action that is not drop, bounce, or spam', () => {
    const config: RouterConfig = {
      domains: {},
      blockSenders: { 'contexttable.skin': 'spma' as any },
    };
    expect(() => validateConfig(config)).toThrow(/contexttable\.skin/);
  });

  test('rejects a forwarding address as a blockSenders action', () => {
    // A block never forwards — an address here is almost certainly a mistake
    const config: RouterConfig = {
      domains: {},
      blockSenders: { 'contexttable.skin': 'me@gmail.com' as any },
    };
    expect(() => validateConfig(config)).toThrow(/contexttable\.skin/);
  });

  test('rejects an empty blockSenders pattern', () => {
    const config: RouterConfig = { domains: {}, blockSenders: { '': 'drop' } };
    expect(() => validateConfig(config)).toThrow(/empty/i);
  });

  test('does not require blockSenders to be present', () => {
    const config: RouterConfig = { domains: { 'routy.com': { catchAll: 'catch@gmail.com' } } };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('accepts a single IP and a CIDR range in blockIps', () => {
    const config: RouterConfig = {
      domains: {},
      blockIps: { '151.247.171.0/24': 'spam', '151.247.171.196': 'drop', '10.0.0.0/8': 'bounce' },
    };
    expect(() => validateConfig(config)).not.toThrow();
  });

  test('rejects a blockIps action that is not drop, bounce, or spam', () => {
    const config: RouterConfig = {
      domains: {},
      blockIps: { '151.247.171.0/24': 'spma' as any },
    };
    expect(() => validateConfig(config)).toThrow(/151\.247\.171\.0\/24/);
  });

  test('rejects a malformed IP in blockIps', () => {
    const config: RouterConfig = { domains: {}, blockIps: { 'not-an-ip': 'spam' } };
    expect(() => validateConfig(config)).toThrow(/not-an-ip/);
  });

  test('rejects an out-of-range octet in blockIps', () => {
    const config: RouterConfig = { domains: {}, blockIps: { '151.247.999.0/24': 'spam' } };
    expect(() => validateConfig(config)).toThrow(/151\.247\.999\.0\/24/);
  });

  test('rejects an impossible prefix length in blockIps', () => {
    const config: RouterConfig = { domains: {}, blockIps: { '151.247.171.0/33': 'spam' } };
    expect(() => validateConfig(config)).toThrow(/151\.247\.171\.0\/33/);
  });

  test('does not require blockIps to be present', () => {
    const config: RouterConfig = { domains: { 'routy.com': { catchAll: 'catch@gmail.com' } } };
    expect(() => validateConfig(config)).not.toThrow();
  });
});
