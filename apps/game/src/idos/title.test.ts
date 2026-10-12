import { describe, expect, it } from 'vitest';
import { detectTitleId } from './title';

const at = (url: string) => {
  const u = new URL(url);
  return detectTitleId({ hostname: u.hostname, pathname: u.pathname, search: u.search });
};

describe('detectTitleId', () => {
  it('reads an uploaded build from its path on static.idos.games', () => {
    expect(at('https://static.idos.games/drive/app/BVTWU78A/v/bld5cdc/index.html')).toBe('BVTWU78A');
    expect(at('https://static.idos.games/drive/app/BVTWU78A-DEV/v/bld5cdc/')).toBe('BVTWU78A-DEV');
  });

  it("reads a title's own address", () => {
    expect(at('https://bvtwu78a.idos.games/')).toBe('BVTWU78A');
    expect(at('https://bvtwu78a-dev.idos.games/')).toBe('BVTWU78A-DEV');
  });

  it('does not take a platform host for a title', () => {
    expect(at('https://static.idos.games/other/file.html')).toBeNull();
    expect(at('https://www.idos.games/')).toBeNull();
  });

  it('falls back to ?title= elsewhere', () => {
    expect(at('http://localhost:5173/?title=ABCD1234')).toBe('ABCD1234');
    expect(at('http://localhost:5173/')).toBeNull();
  });
});
