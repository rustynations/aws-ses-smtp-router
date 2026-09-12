import { resolveSenderBlock, type RouterConfig } from '../../lambda/forwarder/router';
import { extractSenderAddress } from '../../lambda/forwarder/rewriter';

const config: RouterConfig = {
  defaultForwardTo: 'default@gmail.com',
  domains: {
    'example.com': { catchAll: 'catch@gmail.com' },
  },
  blockSenders: {
    'acetoois@contexttable.skin': 'spam',
    'contexttable.skin': 'bounce',
    '*.skin': 'drop',
  },
};

describe('resolveSenderBlock — pattern shapes', () => {
  test('exact address match', () => {
    expect(resolveSenderBlock(config, ['acetoois@contexttable.skin'])).toEqual({ action: 'spam' });
  });

  test('bare domain match', () => {
    expect(resolveSenderBlock(config, ['someone@contexttable.skin'])).toEqual({ action: 'bounce' });
  });

  test('bare domain also matches a subdomain', () => {
    expect(resolveSenderBlock(config, ['bot@em.contexttable.skin'])).toEqual({ action: 'bounce' });
  });

  test('TLD wildcard match', () => {
    expect(resolveSenderBlock(config, ['anyone@othersite.skin'])).toEqual({ action: 'drop' });
  });

  test('unmatched sender is not blocked', () => {
    expect(resolveSenderBlock(config, ['friend@gmail.com'])).toBeNull();
  });

  test('matching is case-insensitive', () => {
    expect(resolveSenderBlock(config, ['AceTooIs@ContextTable.Skin'])).toEqual({ action: 'spam' });
  });

  test('no blockSenders in config means nothing is blocked', () => {
    const bare: RouterConfig = { domains: {} };
    expect(resolveSenderBlock(bare, ['acetoois@contexttable.skin'])).toBeNull();
  });
});

describe('resolveSenderBlock — precedence and multiple candidates', () => {
  test('exact address beats bare domain', () => {
    // acetoois@ is "spam"; the contexttable.skin domain entry is "bounce"
    expect(resolveSenderBlock(config, ['acetoois@contexttable.skin'])).toEqual({ action: 'spam' });
  });

  test('bare domain beats TLD wildcard', () => {
    // contexttable.skin is "bounce"; *.skin is "drop"
    expect(resolveSenderBlock(config, ['someone@contexttable.skin'])).toEqual({ action: 'bounce' });
  });

  test('blocks when only the second candidate matches', () => {
    // Envelope sender is clean, the From header is not
    expect(resolveSenderBlock(config, ['bounces@relay.example', 'acetoois@contexttable.skin'])).toEqual({
      action: 'spam',
    });
  });

  test('ignores empty and malformed candidates', () => {
    expect(resolveSenderBlock(config, ['', 'not-an-address', undefined as any])).toBeNull();
  });
});

describe('extractSenderAddress', () => {
  test('reads the address out of a display-name From header', () => {
    const raw = ['From: "AceTooIs" <acetoois@contexttable.skin>', 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderAddress(raw)).toBe('acetoois@contexttable.skin');
  });

  test('reads a bare address From header', () => {
    const raw = ['From: acetoois@contexttable.skin', 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderAddress(raw)).toBe('acetoois@contexttable.skin');
  });

  test('returns empty string when there is no From header', () => {
    const raw = ['To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderAddress(raw)).toBe('');
  });
});
