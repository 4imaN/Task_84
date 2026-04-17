import { describe, expect, it } from 'vitest';
import { getChapterBody, getReaderSurfaceClass, getReaderFontFamily } from './useReaderWorkspace';

describe('getChapterBody', () => {
  const chapter = {
    id: 'ch-1',
    title: 'Chapter 1',
    body: 'Default body text',
    bodyTraditional: '傳統中文',
    bodySimplified: '简体中文',
  };

  it('returns simplified body when chineseMode is undefined (non-TRADITIONAL fallthrough)', () => {
    expect(getChapterBody(chapter, undefined as never)).toBe('简体中文');
  });

  it('returns traditional body when chineseMode is TRADITIONAL', () => {
    expect(getChapterBody(chapter, 'TRADITIONAL')).toBe('傳統中文');
  });

  it('returns simplified body when chineseMode is not TRADITIONAL', () => {
    expect(getChapterBody(chapter, 'SIMPLIFIED')).toBe('简体中文');
  });

  it('falls back to default body when traditional variant is missing', () => {
    const noTraditional = { ...chapter, bodyTraditional: undefined };
    expect(getChapterBody(noTraditional as never, 'TRADITIONAL')).toBe('Default body text');
  });

  it('falls back to default body when simplified variant is missing', () => {
    const noSimplified = { ...chapter, bodySimplified: undefined };
    expect(getChapterBody(noSimplified as never, 'SIMPLIFIED')).toBe('Default body text');
  });

  it('returns empty string when chapter is undefined', () => {
    expect(getChapterBody(undefined, 'TRADITIONAL')).toBe('');
  });
});

describe('getReaderSurfaceClass', () => {
  it('returns night mode class when nightMode is true', () => {
    expect(getReaderSurfaceClass({ nightMode: true } as never)).toBe('bg-[#161612] text-[#f8f4ea]');
  });

  it('returns linen theme class', () => {
    expect(getReaderSurfaceClass({ theme: 'linen' } as never)).toBe('bg-[#f2ede0] text-[#231f1a]');
  });

  it('returns mist theme class', () => {
    expect(getReaderSurfaceClass({ theme: 'mist' } as never)).toBe('bg-[#e8eef1] text-[#1b2830]');
  });

  it('returns sepia theme class', () => {
    expect(getReaderSurfaceClass({ theme: 'sepia' } as never)).toBe('bg-[#ead8bf] text-[#2e2216]');
  });

  it('returns default warm paper class when no theme matches', () => {
    expect(getReaderSurfaceClass({} as never)).toBe('bg-[#f8f3e8] text-[#1c1b17]');
  });

  it('returns default class when preferences are undefined', () => {
    expect(getReaderSurfaceClass(undefined)).toBe('bg-[#f8f3e8] text-[#1c1b17]');
  });

  it('prioritizes nightMode over theme', () => {
    expect(getReaderSurfaceClass({ nightMode: true, theme: 'linen' } as never)).toBe(
      'bg-[#161612] text-[#f8f4ea]',
    );
  });
});

describe('getReaderFontFamily', () => {
  it('returns sans-serif stack for Noto Sans', () => {
    expect(getReaderFontFamily('Noto Sans')).toBe('"Avenir Next", "Segoe UI", sans-serif');
  });

  it('returns Georgia stack for Source Serif', () => {
    expect(getReaderFontFamily('Source Serif')).toBe('Georgia, serif');
  });

  it('returns Palatino stack as default', () => {
    expect(getReaderFontFamily(undefined as never)).toBe('"Palatino Linotype", Palatino, serif');
  });

  it('returns Palatino stack for unknown font family', () => {
    expect(getReaderFontFamily('Unknown Font' as never)).toBe(
      '"Palatino Linotype", Palatino, serif',
    );
  });
});
