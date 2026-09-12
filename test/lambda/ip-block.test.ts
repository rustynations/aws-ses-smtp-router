import { resolveIpBlock, type RouterConfig } from '../../lambda/forwarder/router';
import { extractSenderIp } from '../../lambda/forwarder/rewriter';

const config: RouterConfig = {
  domains: { 'example.com': { catchAll: 'catch@gmail.com' } },
  blockIps: {
    '151.247.171.0/24': 'spam',
    '151.247.171.196': 'drop',
    '10.0.0.0/8': 'bounce',
  },
};

describe('resolveIpBlock', () => {
  test('exact IP match', () => {
    expect(resolveIpBlock(config, '151.247.171.196')).toEqual({ action: 'drop' });
  });

  test('CIDR range match', () => {
    expect(resolveIpBlock(config, '151.247.171.80')).toEqual({ action: 'spam' });
  });

  test('an exact IP entry beats the range that contains it', () => {
    // .196 is inside the /24 (spam) but has its own entry (drop)
    expect(resolveIpBlock(config, '151.247.171.196')).toEqual({ action: 'drop' });
  });

  test('an address just outside the range is not blocked', () => {
    expect(resolveIpBlock(config, '151.247.172.80')).toBeNull();
    expect(resolveIpBlock(config, '151.247.170.255')).toBeNull();
  });

  test('both edges of the range are blocked', () => {
    expect(resolveIpBlock(config, '151.247.171.0')).toEqual({ action: 'spam' });
    expect(resolveIpBlock(config, '151.247.171.255')).toEqual({ action: 'spam' });
  });

  test('a wider range still matches', () => {
    expect(resolveIpBlock(config, '10.55.99.1')).toEqual({ action: 'bounce' });
  });

  test('a longer prefix wins over a shorter one', () => {
    const nested: RouterConfig = {
      domains: {},
      blockIps: { '151.247.0.0/16': 'drop', '151.247.171.0/24': 'spam' },
    };
    expect(resolveIpBlock(nested, '151.247.171.80')).toEqual({ action: 'spam' });
    expect(resolveIpBlock(nested, '151.247.99.1')).toEqual({ action: 'drop' });
  });

  test('unblocked address returns null', () => {
    expect(resolveIpBlock(config, '8.8.8.8')).toBeNull();
  });

  test('no blockIps in config means nothing is blocked', () => {
    expect(resolveIpBlock({ domains: {} }, '151.247.171.80')).toBeNull();
  });

  test('missing or malformed address is not blocked', () => {
    expect(resolveIpBlock(config, '')).toBeNull();
    expect(resolveIpBlock(config, 'not-an-ip')).toBeNull();
    expect(resolveIpBlock(config, '151.247.171')).toBeNull();
    expect(resolveIpBlock(config, '999.999.999.999')).toBeNull();
  });

  test('an IPv6 sender is not blocked by an IPv4 rule', () => {
    expect(resolveIpBlock(config, '2001:db8::1')).toBeNull();
  });
});

describe('extractSenderIp', () => {
  const sesHeader =
    'Received-SPF: pass (spfCheck: domain of differentsend.living designates ' +
    '151.247.171.80 as permitted sender) client-ip=151.247.171.80; ' +
    'envelope-from=x@differentsend.living; helo=mta1.differentsend.living;';

  test('reads client-ip from the SES-written header', () => {
    const raw = [sesHeader, 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('151.247.171.80');
  });

  test('ignores a forged header the sender wrote below it', () => {
    const forged = 'Received-SPF: pass (spfCheck: whatever) client-ip=8.8.8.8;';
    const raw = [sesHeader, forged, 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('151.247.171.80');
  });

  test('ignores a header that is not from the SES spf check', () => {
    const notSes = 'Received-SPF: pass (google.com: domain of x) client-ip=8.8.8.8;';
    const raw = [notSes, sesHeader, 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('151.247.171.80');
  });

  test('returns empty string when there is no SES spf header', () => {
    const raw = ['To: a@b.com', 'Subject: hi', '', 'body'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('');
  });

  test('does not read a client-ip out of the body', () => {
    const raw = ['To: a@b.com', '', 'Received-SPF: (spfCheck:) client-ip=6.6.6.6;'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('');
  });

  test('reads a folded header', () => {
    const folded = [
      'Received-SPF: pass (spfCheck: domain of differentsend.living designates',
      '  151.247.171.80 as permitted sender) client-ip=151.247.171.80;',
    ].join('\r\n');
    const raw = [folded, 'To: a@b.com', '', 'body'].join('\r\n');
    expect(extractSenderIp(raw)).toBe('151.247.171.80');
  });
});
