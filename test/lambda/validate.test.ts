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
});
