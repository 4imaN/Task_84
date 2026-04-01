import { useQuery } from '@tanstack/react-query';
import { DiscrepancyReviewSection } from '../../components/admin/DiscrepancyReviewSection';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { useAppContext } from '../../context/AppContext';
import { apiRequest } from '../../lib/api';
import type { SettlementResponse } from '../../lib/types';

export function InventoryPage() {
  const { session } = useAppContext();
  const settlements = useQuery({
    queryKey: ['settlements'],
    queryFn: () => apiRequest<SettlementResponse>('/admin/settlements', {}, session),
  });

  return (
    <QueryBoundary
      isPending={settlements.isPending}
      isError={settlements.isError}
      isEmpty={(settlements.data?.discrepancies.length ?? 0) === 0}
      emptyTitle="No Discrepancies"
      emptyMessage="Inventory reconciliation is currently clear."
      errorMessage="Inventory discrepancy data could not be loaded."
      onRetry={() => void settlements.refetch()}
      loading={<div className="skeleton h-64" />}
    >
      <DiscrepancyReviewSection discrepancies={settlements.data?.discrepancies ?? []} />
    </QueryBoundary>
  );
}
