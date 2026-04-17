import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAsyncAction } from './useAsyncAction';

vi.mock('../context/AppContext', () => ({
  useAppContext: () => ({
    addToast: vi.fn(),
  }),
}));

const getAddToast = () => {
  const { useAppContext } = require('../context/AppContext');
  return useAppContext().addToast;
};

describe('useAsyncAction', () => {
  it('tracks pending state during async action', async () => {
    const { result } = renderHook(() => useAsyncAction());

    expect(result.current.anyPending).toBe(false);
    expect(result.current.isPending('test-key')).toBe(false);

    let resolveAction!: (value: string) => void;
    const action = new Promise<string>((resolve) => {
      resolveAction = resolve;
    });

    let actionPromise: Promise<unknown>;
    act(() => {
      actionPromise = result.current.runAction('test-key', () => action);
    });

    expect(result.current.isPending('test-key')).toBe(true);
    expect(result.current.anyPending).toBe(true);

    await act(async () => {
      resolveAction('done');
      await actionPromise;
    });

    expect(result.current.isPending('test-key')).toBe(false);
    expect(result.current.anyPending).toBe(false);
  });

  it('prevents duplicate concurrent actions for the same key', async () => {
    const { result } = renderHook(() => useAsyncAction());
    let callCount = 0;

    let resolveAction!: () => void;
    const action = () =>
      new Promise<void>((resolve) => {
        callCount++;
        resolveAction = resolve;
      });

    let firstPromise: Promise<unknown>;
    act(() => {
      firstPromise = result.current.runAction('dup-key', action);
    });

    let secondResult: unknown;
    act(() => {
      secondResult = result.current.runAction('dup-key', action);
    });

    await act(async () => {
      resolveAction();
      await firstPromise;
      await secondResult;
    });

    expect(callCount).toBe(1);
  });

  it('returns the action result on success', async () => {
    const { result } = renderHook(() => useAsyncAction());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.runAction('key', async () => 42);
    });

    expect(returned).toBe(42);
  });

  it('returns undefined on error without rethrow', async () => {
    const { result } = renderHook(() => useAsyncAction());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.runAction(
        'err-key',
        async () => {
          throw new Error('boom');
        },
        { suppressErrorToast: true },
      );
    });

    expect(returned).toBeUndefined();
  });

  it('rethrows when rethrow option is set', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await expect(
      act(async () => {
        await result.current.runAction(
          'rethrow-key',
          async () => {
            throw new Error('rethrown');
          },
          { rethrow: true, suppressErrorToast: true },
        );
      }),
    ).rejects.toThrow('rethrown');
  });

  it('clears pending state after error', async () => {
    const { result } = renderHook(() => useAsyncAction());

    await act(async () => {
      await result.current.runAction(
        'fail-key',
        async () => {
          throw new Error('fail');
        },
        { suppressErrorToast: true },
      );
    });

    expect(result.current.isPending('fail-key')).toBe(false);
    expect(result.current.anyPending).toBe(false);
  });
});
