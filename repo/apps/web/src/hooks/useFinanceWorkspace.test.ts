import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../context/AppContext', () => ({
  useAppContext: vi.fn(),
}));

vi.mock('./useAsyncAction', () => ({
  useAsyncAction: () => ({
    isPending: vi.fn(() => false),
    runAction: vi.fn(async (_key: string, action: () => Promise<unknown>) => action()),
  }),
}));

vi.mock('../lib/api', () => ({
  apiRequest: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      paymentPlans: [
        { id: 'plan-1', status: 'DISPUTED' },
        { id: 'plan-2', status: 'PENDING' },
      ],
      discrepancies: [
        { id: 'disc-1', status: 'OPEN' },
        { id: 'disc-2', status: 'RESOLVED' },
        { id: 'disc-3', status: 'OPEN' },
      ],
    },
    refetch: vi.fn(),
  }),
}));

import { useAppContext } from '../context/AppContext';

const makeSession = (role: string, workspace = 'admin') => ({
  user: { id: 'u-1', username: 'test', role, workspace },
  homePath: '/admin/overview',
  csrfToken: 'csrf',
});

describe('useFinanceWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('role-based permissions', () => {
    const cases: [string, boolean, boolean, boolean][] = [
      // [role, canImportManifest, canUpdatePaymentPlans, canUpdateDiscrepancies]
      ['MANAGER', true, true, true],
      ['FINANCE', false, true, false],
      ['INVENTORY_MANAGER', true, false, true],
      ['CUSTOMER', false, false, false],
    ];

    it.each(cases)(
      'computes correct permissions for %s',
      async (role, expectImport, expectPayment, expectDiscrepancy) => {
        vi.mocked(useAppContext).mockReturnValue({
          session: makeSession(role),
          addToast: vi.fn(),
        } as any);

        const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
        const { result } = renderHook(() => useFinanceWorkspace());

        expect(result.current.canImportManifest).toBe(expectImport);
        expect(result.current.canUpdatePaymentPlans).toBe(expectPayment);
        expect(result.current.canUpdateDiscrepancies).toBe(expectDiscrepancy);
      },
    );
  });

  describe('metrics computation', () => {
    it('computes correct aggregated metrics from items and settlements data', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast: vi.fn(),
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      expect(result.current.metrics.visiblePlanCount).toBe(2);
      expect(result.current.metrics.openDiscrepancyCount).toBe(2);
      expect(result.current.metrics.disputedPlanCount).toBe(1);
      expect(result.current.metrics.statementUnits).toBe(30);
      expect(result.current.metrics.invoiceUnits).toBe(28);
    });
  });

  describe('manifest row management', () => {
    it('adds a blank row and removes a row by index', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast: vi.fn(),
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      const initialLength = result.current.items.length;

      act(() => {
        result.current.addManifestRow();
      });
      expect(result.current.items).toHaveLength(initialLength + 1);
      expect(result.current.items[result.current.items.length - 1].sku).toBe('');

      act(() => {
        result.current.removeManifestRow(result.current.items.length - 1);
      });
      expect(result.current.items).toHaveLength(initialLength);
    });

    it('uppercases SKU values and coerces numeric fields on update', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast: vi.fn(),
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      act(() => {
        result.current.updateManifestItem(0, 'sku', 'sku-new-print');
      });
      expect(result.current.items[0].sku).toBe('SKU-NEW-PRINT');

      act(() => {
        result.current.updateManifestItem(0, 'statementQuantity', '99');
      });
      expect(result.current.items[0].statementQuantity).toBe(99);
    });
  });

  describe('manifest validation', () => {
    it('rejects import when a populated row has no SKU', async () => {
      const addToast = vi.fn();
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast,
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      act(() => {
        result.current.addManifestRow();
      });

      act(() => {
        result.current.updateManifestItem(result.current.items.length - 1, 'statementQuantity', 5);
      });

      await act(async () => {
        await result.current.importManifest();
      });

      expect(addToast).toHaveBeenCalledWith(
        'Every populated manifest row needs a SKU before import.',
      );
    });

    it('rejects import when all items have empty SKUs', async () => {
      const addToast = vi.fn();
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast,
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      act(() => {
        for (let i = result.current.items.length - 1; i >= 0; i--) {
          result.current.removeManifestRow(i);
        }
      });

      act(() => {
        result.current.addManifestRow();
      });

      await act(async () => {
        await result.current.importManifest();
      });

      expect(addToast).toHaveBeenCalledWith('Add at least one manifest row before importing.');
    });
  });

  describe('audit path', () => {
    it('returns /finance/audits for finance workspace', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        session: { ...makeSession('FINANCE', 'finance'), homePath: '/finance/settlements' },
        addToast: vi.fn(),
      } as any);

      // Need to change the session.user.workspace
      vi.mocked(useAppContext).mockReturnValue({
        session: {
          user: { id: 'u-1', username: 'finance.zoe', role: 'FINANCE', workspace: 'finance' },
          homePath: '/finance/settlements',
          csrfToken: 'csrf',
        },
        addToast: vi.fn(),
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      expect(result.current.auditPath).toBe('/finance/audits');
    });

    it('returns /admin/audits for admin workspace', async () => {
      vi.mocked(useAppContext).mockReturnValue({
        session: makeSession('MANAGER'),
        addToast: vi.fn(),
      } as any);

      const { useFinanceWorkspace } = await import('./useFinanceWorkspace');
      const { result } = renderHook(() => useFinanceWorkspace());

      expect(result.current.auditPath).toBe('/admin/audits');
    });
  });
});
