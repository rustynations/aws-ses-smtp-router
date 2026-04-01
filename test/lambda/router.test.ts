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
    'bare-domain.com': {
      catchAll: 'bare@gmail.com',
    },
    'empty-domain.com': {},
  },
};

describe('resolveRoute', () => {
  test('exact address match takes priority', () => {
    expect(resolveRoute(config, 'sales@example.com')).toBe('sales@gmail.com');
  });

  test('catchAll used when no exact match', () => {
    expect(resolveRoute(config, 'random@example.com')).toBe('catch@gmail.com');
  });

  test('defaultForwardTo used when domain has no catchAll', () => {
    expect(resolveRoute(config, 'anyone@empty-domain.com')).toBe('default@gmail.com');
  });

  test('defaultForwardTo used for unknown domain', () => {
    expect(resolveRoute(config, 'user@unknown.com')).toBe('default@gmail.com');
  });

  test('returns null when no route and no default', () => {
    const noDefault: RouterConfig = {
      domains: {
        'example.com': {},
      },
    };
    expect(resolveRoute(noDefault, 'user@unknown.com')).toBeNull();
  });

  test('domain with only catchAll works', () => {
    expect(resolveRoute(config, 'anything@bare-domain.com')).toBe('bare@gmail.com');
  });

  test('recipient is case-insensitive', () => {
    expect(resolveRoute(config, 'Sales@Example.com')).toBe('sales@gmail.com');
  });
});
