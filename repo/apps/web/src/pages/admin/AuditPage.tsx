import { useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { useAppContext } from '../../context/AppContext';
import { apiRequest } from '../../lib/api';
import { currency, formatReadableDateTime, isDateLikeKey } from '../../lib/format';
import type { AuditLog, AuditPayloadValue } from '../../lib/types';

const SENSITIVE_AUDIT_KEY_PATTERN =
  /(signature|hash|cipher|token|password|secret|note|notes|body|fingerprint)/i;
const SAFE_AUDIT_KEY_PATTERN =
  /(Id|At|sku|quantity|availableQuantity|requestedQuantity|rating|active|category|commentType|paymentMethod|deviceLabel|resolution|status|total|subtotal|discount|fee|price|amount|method)/i;

const toAuditLabel = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

export function AuditPage() {
  const { session } = useAppContext();
  const auditLogs = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => apiRequest<AuditLog[]>('/admin/audit-logs', {}, session),
  });

  const formatPayloadValue = (key: string, value: unknown) => {
    if (isDateLikeKey(key)) {
      return formatReadableDateTime(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    if (typeof value === 'number') {
      return key.toLowerCase().includes('cents') ? currency(value / 100) : String(value);
    }

    if (value === null || value === undefined || value === '') {
      return 'None';
    }

    return String(value);
  };

  const getPayloadSummary = (payload: Record<string, unknown>) => {
    const safeEntries: AuditPayloadValue[] = [];
    let redactedCount = 0;

    for (const [key, value] of Object.entries(payload)) {
      if (SENSITIVE_AUDIT_KEY_PATTERN.test(key)) {
        redactedCount += 1;
        continue;
      }

      if (!SAFE_AUDIT_KEY_PATTERN.test(key) && !isDateLikeKey(key)) {
        redactedCount += 1;
        continue;
      }

      safeEntries.push({
        key,
        label: toAuditLabel(key),
        value: formatPayloadValue(key, value),
      });
    }

    return {
      safeEntries,
      redactedCount,
    };
  };

  return (
    <QueryBoundary
      isPending={auditLogs.isPending}
      isError={auditLogs.isError}
      isEmpty={(auditLogs.data?.length ?? 0) === 0}
      emptyTitle="No Audit Rows"
      emptyMessage="No audit log rows are currently available."
      errorMessage="Audit log data could not be loaded."
      onRetry={() => void auditLogs.refetch()}
      loading={<div className="skeleton h-64" />}
    >
      <div className="space-y-3">
        {(auditLogs.data ?? []).map((log) => (
          <article key={log.id} className="shell-panel p-5">
            {(() => {
              const payloadSummary = getPayloadSummary(log.payload);

              return (
                <>
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
                  {log.trace_id}
                </p>
                <h2 className="mt-2 font-display text-3xl">
                  {log.action} · {log.entity_type}
                </h2>
                <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">Entity: {log.entity_id}</p>
              </div>
              <p className="font-ui text-sm text-black/55 dark:text-white/55">{formatReadableDateTime(log.created_at)}</p>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {payloadSummary.safeEntries.map((entry) => (
                <div key={entry.key} className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
                  <p className="font-ui text-[11px] uppercase tracking-[0.18em] text-black/45 dark:text-white/45">
                    {entry.label}
                  </p>
                  <p className="mt-2 font-ui text-sm text-black/75 dark:text-white/75">
                    {entry.value}
                  </p>
                </div>
              ))}
            </div>
            {payloadSummary.redactedCount > 0 ? (
              <div className="mt-4 rounded-2xl border border-dashed border-black/10 px-4 py-3 font-ui text-sm text-black/55 dark:border-white/10 dark:text-white/55">
                {payloadSummary.redactedCount} payload field{payloadSummary.redactedCount > 1 ? 's were' : ' was'} hidden for operational safety.
              </div>
            ) : null}
                </>
              );
            })()}
          </article>
        ))}
      </div>
    </QueryBoundary>
  );
}
