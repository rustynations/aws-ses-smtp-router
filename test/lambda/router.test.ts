import { resolveRoute, type RouterConfig } from '../../lambda/forwarder/router';

const config: RouterConfig = {
  defaultForwardTo: 'default@gmail.com',
  domains: {
    'example.com': {
      catchAll: 'catch@gmail.com',
      routes: {
        'sales@example.com': 'sales@gmail.com',
        'support@example.com': 'support@gmail.com',
      },
    },
    'bare-domain.com': { catchAll: 'bare@gmail.com' },
    'empty-domain.com': {},
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

describe('resolveRoute', () => {
  test('exact address match forwards', () => {
    expect(resolveRoute(config, 'sales@example.com')).toEqual({ action: 'forward', to: 'sales@gmail.com' });
  });
  test('catchAll used when no exact match', () => {
    expect(resolveRoute(config, 'random@example.com')).toEqual({ action: 'forward', to: 'catch@gmail.com' });
  });
  test('defaultForwardTo used when domain has no catchAll', () => {
    expect(resolveRoute(config, 'anyone@empty-domain.com')).toEqual({ action: 'forward', to: 'default@gmail.com' });
  });
  test('defaultForwardTo used for unknown domain', () => {
    expect(resolveRoute(config, 'user@unknown.com')).toEqual({ action: 'forward', to: 'default@gmail.com' });
  });
  test('drops when no route and no default', () => {
    const noDefault: RouterConfig = { domains: { 'example.com': {} } };
    expect(resolveRoute(noDefault, 'user@unknown.com')).toEqual({ action: 'drop' });
  });
  test('recipient is case-insensitive', () => {
    expect(resolveRoute(config, 'Sales@Example.com')).toEqual({ action: 'forward', to: 'sales@gmail.com' });
  });

  test('"bounce" route resolves to bounce action', () => {
    expect(resolveRoute(config, 'dennis@routy.com')).toEqual({ action: 'bounce' });
  });
  test('"drop" route resolves to drop action', () => {
    expect(resolveRoute(config, 'spam-magnet@routy.com')).toEqual({ action: 'drop' });
  });
  test('block short-circuits before catchAll', () => {
    // dennis is blocked even though routy.com has a catch-all
    expect(resolveRoute(config, 'dennis@routy.com')).toEqual({ action: 'bounce' });
  });
  test('unlisted address on a domain with a block still hits catchAll', () => {
    expect(resolveRoute(config, 'someone@routy.com')).toEqual({ action: 'forward', to: 'catch@gmail.com' });
  });
});
