import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAppContext } from '../context/AppContext';
import { useAsyncAction } from './useAsyncAction';
import { apiRequest } from '../lib/api';
import type { ManifestLineItem, PaymentPlanStatus, SettlementResponse } from '../lib/types';

const defaultManifestItems: ManifestLineItem[] = [
  {
    sku: 'SKU-QH-PRINT',
    statementQuantity: 30,
    invoiceQuantity: 28,
    statementExtendedAmount: 720,
    invoiceExtendedAmount: 690,
  },
];

export function useFinanceWorkspace() {
  const { session, addToast } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const canImportManifest =
    session?.user.role === 'MANAGER' || session?.user.role === 'INVENTORY_MANAGER';
  const [supplierName, setSupplierName] = useState('North Pier Press');
  const [sourceFilename, setSourceFilename] = useState('statement-invoice.json');
  const [statementReference, setStatementReference] = useState('STMT-2026-03-28-A');
  const [invoiceReference, setInvoiceReference] = useState('INV-2026-03-28-A');
  const [freightAmount, setFreightAmount] = useState(8);
  const [surchargeAmount, setSurchargeAmount] = useState(2);
  const [paymentPlanStatus, setPaymentPlanStatus] = useState<PaymentPlanStatus>('PENDING');
  const [items, setItems] = useState<ManifestLineItem[]>(defaultManifestItems);

  const settlements = useQuery({
    queryKey: ['settlements'],
    queryFn: () => apiRequest<SettlementResponse>('/admin/settlements', {}, session),
  });

  const auditPath = session?.user.workspace === 'finance' ? '/finance/audits' : '/admin/audits';

  const metrics = useMemo(() => {
    const statementUnits = items.reduce((sum, item) => sum + item.statementQuantity, 0);
    const invoiceUnits = items.reduce((sum, item) => sum + item.invoiceQuantity, 0);
    const statementAmount = items.reduce((sum, item) => sum + item.statementExtendedAmount, 0);
    const invoiceAmount = items.reduce((sum, item) => sum + item.invoiceExtendedAmount, 0);
    const visiblePlanCount = settlements.data?.paymentPlans.length ?? 0;
    const openDiscrepancyCount = (settlements.data?.discrepancies ?? []).filter((item) => item.status === 'OPEN').length;
    const disputedPlanCount = (settlements.data?.paymentPlans ?? []).filter((plan) => plan.status === 'DISPUTED').length;

    return {
      visiblePlanCount,
      statementUnits,
      invoiceUnits,
      statementAmount,
      invoiceAmount,
      openDiscrepancyCount,
      disputedPlanCount,
    };
  }, [items, settlements.data]);

  const updateManifestItem = (index: number, key: keyof ManifestLineItem, value: string | number) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              [key]: key === 'sku' ? String(value).toUpperCase() : Number(value),
            }
          : item,
      ),
    );
  };

  const addManifestRow = () => {
    setItems((current) => [
      ...current,
      {
        sku: '',
        statementQuantity: 0,
        invoiceQuantity: 0,
        statementExtendedAmount: 0,
        invoiceExtendedAmount: 0,
      },
    ]);
  };

  const removeManifestRow = (index: number) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const importManifest = async () => {
    const incompleteRow = items.find(
      (item) =>
        !item.sku.trim() &&
        (item.statementQuantity > 0 ||
          item.invoiceQuantity > 0 ||
          item.statementExtendedAmount > 0 ||
          item.invoiceExtendedAmount > 0),
    );

    if (incompleteRow) {
      addToast('Every populated manifest row needs a SKU before import.');
      return;
    }

    const normalizedItems = items
      .filter((item) => item.sku.trim())
      .map((item) => ({
        sku: item.sku.trim(),
        statementQuantity: item.statementQuantity,
        invoiceQuantity: item.invoiceQuantity,
        statementExtendedAmountCents: Math.round(item.statementExtendedAmount * 100),
        invoiceExtendedAmountCents: Math.round(item.invoiceExtendedAmount * 100),
      }));

    if (normalizedItems.length === 0) {
      addToast('Add at least one manifest row before importing.');
      return;
    }

    await runAction(
      'finance-import-manifest',
      async () => {
        await apiRequest(
          '/admin/manifests/import',
          {
            method: 'POST',
            body: JSON.stringify({
              supplierName,
              sourceFilename,
              statementReference,
              invoiceReference,
              freightCents: Math.round(freightAmount * 100),
              surchargeCents: Math.round(surchargeAmount * 100),
              paymentPlanStatus,
              items: normalizedItems,
            }),
          },
          session,
        );
        await settlements.refetch();
        return true;
      },
      {
        successMessage:
          'Supplier statement and invoice imported. Landed cost allocation and discrepancy rules were applied.',
        errorMessage: (error) => (error instanceof Error ? error.message : 'Manifest import failed.'),
      },
    );
  };

  return {
    addManifestRow,
    auditPath,
    canImportManifest,
    freightAmount,
    importManifest,
    invoiceReference,
    isPending,
    items,
    metrics,
    paymentPlanStatus,
    removeManifestRow,
    session,
    setFreightAmount,
    setInvoiceReference,
    setPaymentPlanStatus,
    setSourceFilename,
    setStatementReference,
    setSupplierName,
    setSurchargeAmount,
    settlements,
    sourceFilename,
    statementReference,
    supplierName,
    surchargeAmount,
    updateManifestItem,
  };
}
