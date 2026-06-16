import { describe, it, expect, vi } from 'vitest';
import {
  D2S_SERVER_PARAM,
  getD2sServerValue,
  maybeHandleDeepLink,
} from '../src/lib/utils/deep-link';

const params = (search: string) => new URLSearchParams(search);

describe('getD2sServerValue', () => {
  it('returns the value when the parameter is present', () => {
    expect(
      getD2sServerValue(params('?d2s-server=https://ps2.d2s.org')),
    ).toBe('https://ps2.d2s.org');
  });

  it('percent-decodes the value', () => {
    expect(getD2sServerValue(params('d2s-server=https%3A%2F%2Fps2.d2s.org'))).toBe(
      'https://ps2.d2s.org',
    );
  });

  it('ignores other parameters', () => {
    expect(getD2sServerValue(params('a=1&d2s-server=https://x.d2s.org&b=2'))).toBe(
      'https://x.d2s.org',
    );
  });

  it('returns null when the parameter is absent', () => {
    expect(getD2sServerValue(params('?foo=bar'))).toBeNull();
    expect(getD2sServerValue(params(''))).toBeNull();
  });

  it('returns null when the parameter is blank or whitespace', () => {
    expect(getD2sServerValue(params('?d2s-server='))).toBeNull();
    expect(getD2sServerValue(params('?d2s-server=%20%20'))).toBeNull();
  });

  it('exposes the parameter name', () => {
    expect(D2S_SERVER_PARAM).toBe('d2s-server');
  });
});

describe('maybeHandleDeepLink', () => {
  it('forwards the value when the parameter is present', () => {
    const consumer = { setServerUrl: vi.fn() };
    maybeHandleDeepLink(consumer, params('?d2s-server=https://ps2.d2s.org'));
    expect(consumer.setServerUrl).toHaveBeenCalledOnce();
    expect(consumer.setServerUrl).toHaveBeenCalledWith('https://ps2.d2s.org');
  });

  it('does nothing when the parameter is absent or blank', () => {
    const consumer = { setServerUrl: vi.fn() };
    maybeHandleDeepLink(consumer, params('?other=1'));
    maybeHandleDeepLink(consumer, params('?d2s-server='));
    expect(consumer.setServerUrl).not.toHaveBeenCalled();
  });
});
