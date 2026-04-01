import { useCallback, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../context/AppContext';

type AsyncActionOptions<TResult> = {
  successMessage?: string | ((result: TResult) => string);
  errorMessage?: string | ((error: unknown) => string);
  suppressErrorToast?: boolean;
  rethrow?: boolean;
};

const toMessage = (value: string | ((input: any) => string) | undefined, input: unknown) => {
  if (!value) {
    return null;
  }

  return typeof value === 'function' ? value(input) : value;
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'The request failed.';

export function useAsyncAction() {
  const { addToast } = useAppContext();
  const [pendingKeys, setPendingKeys] = useState<Record<string, boolean>>({});
  const pendingKeysRef = useRef<Record<string, boolean>>({});

  const isPending = useCallback((key: string) => Boolean(pendingKeys[key]), [pendingKeys]);
  const anyPending = useMemo(() => Object.values(pendingKeys).some(Boolean), [pendingKeys]);

  const runAction = useCallback(
    async <TResult,>(
      key: string,
      action: () => Promise<TResult>,
      options: AsyncActionOptions<TResult> = {},
    ) => {
      if (pendingKeysRef.current[key]) {
        return undefined as TResult | undefined;
      }

      pendingKeysRef.current = { ...pendingKeysRef.current, [key]: true };
      setPendingKeys((current) => ({ ...current, [key]: true }));
      try {
        const result = await action();
        const successMessage = toMessage(options.successMessage, result);
        if (successMessage) {
          addToast(successMessage);
        }
        return result;
      } catch (error) {
        if (!options.suppressErrorToast) {
          addToast(toMessage(options.errorMessage, error) ?? getErrorMessage(error));
        }
        if (options.rethrow) {
          throw error;
        }
        return undefined as TResult | undefined;
      } finally {
        const nextRef = { ...pendingKeysRef.current };
        delete nextRef[key];
        pendingKeysRef.current = nextRef;
        setPendingKeys((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    },
    [addToast],
  );

  return {
    anyPending,
    isPending,
    runAction,
  };
}
