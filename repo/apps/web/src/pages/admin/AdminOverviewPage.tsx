import { useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { Metric } from '../../components/common/Metric';
import { useAppContext } from '../../context/AppContext';
import { apiRequest } from '../../lib/api';
import type { AuditIntegrityResponse, SettlementResponse } from '../../lib/types';

export function AdminOverviewPage() {
  const { session } = useAppContext();
  const settlements = useQuery({
    queryKey: ['settlements'],
    queryFn: () => apiRequest<SettlementResponse>('/admin/settlements', {}, session),
  });
  const auditIntegrity = useQuery({
    queryKey: ['audit-integrity'],
    queryFn: () => apiRequest<AuditIntegrityResponse>('/admin/audit-integrity', {}, session),
  });

  const auditIntegrityLabel = auditIntegrity.isPending
    ? 'Checking...'
    : auditIntegrity.isError
      ? 'Unknown'
      : auditIntegrity.data.auditLogs.valid && auditIntegrity.data.attendanceRecords.valid
        ? 'Healthy'
        : 'Invalid';

  return (
    <QueryBoundary
      isPending={settlements.isPending}
      isError={settlements.isError}
      loading={<div className="skeleton h-40" />}
      errorMessage="Admin overview metrics could not be loaded."
      onRetry={() => void settlements.refetch()}
    >
      <div className="grid gap-5 lg:grid-cols-3">
        <Metric label="Payment Plans" value={String(settlements.data?.paymentPlans.length ?? 0)} accent />
        <Metric label="Open Discrepancies" value={String(settlements.data?.discrepancies.length ?? 0)} />
        <Metric label="Audit Integrity" value={auditIntegrityLabel} />
      </div>
    </QueryBoundary>
  );
}
