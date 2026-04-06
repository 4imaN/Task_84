import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryBoundary } from '../../components/common/QueryBoundary';
import { useAppContext } from '../../context/AppContext';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { apiRequest } from '../../lib/api';
import { formatReadableDateTime } from '../../lib/format';
import type { RiskAlert } from '../../lib/types';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

const checksumFile = async (file: File) => {
  const buffer =
    typeof file.arrayBuffer === 'function'
      ? await file.arrayBuffer()
      : await new Response(file).arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
};

export function AttendancePage() {
  const { session, addToast } = useAppContext();
  const { isPending, runAction } = useAsyncAction();
  const [expectedChecksum, setExpectedChecksum] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [localChecksum, setLocalChecksum] = useState('');
  const [fileStatus, setFileStatus] = useState('');
  const risks = useQuery({
    queryKey: ['attendance-risks'],
    queryFn: () => apiRequest<RiskAlert[]>('/attendance/risks', {}, session),
  });

  const checksumMismatch = Boolean(
    file && expectedChecksum.trim() && localChecksum && expectedChecksum.trim() !== localChecksum,
  );
  const invalidEvidenceType = Boolean(file && !ALLOWED_TYPES.has(file.type));
  const checksumRequired = Boolean(file && !expectedChecksum.trim());

  const handleFileChange = async (nextFile: File | null) => {
    setFile(nextFile);
    setLocalChecksum('');
    if (!nextFile) {
      setFileStatus('');
      return;
    }

    if (!ALLOWED_TYPES.has(nextFile.type)) {
      setFileStatus('Unsupported evidence type. Use PNG, JPEG, or WebP.');
      return;
    }

    try {
      const digest = await checksumFile(nextFile);
      setLocalChecksum(digest);
      setFileStatus(
        expectedChecksum.trim()
          ? expectedChecksum.trim() === digest
            ? 'Checksum matches the expected value.'
            : 'Checksum does not match the expected value.'
          : 'Checksum computed locally and ready to compare.',
      );
    } catch {
      setFile(null);
      setFileStatus('Checksum could not be computed for this file.');
      addToast('Local checksum generation failed for the selected evidence file.');
    }
  };

  const submit = async (eventType: 'clock-in' | 'clock-out') => {
    if (checksumMismatch) {
      addToast('Fix the checksum mismatch before submitting attendance evidence.');
      return;
    }

    if (checksumRequired) {
      addToast('Enter the expected checksum before submitting attendance evidence.');
      return;
    }

    if (file && !ALLOWED_TYPES.has(file.type)) {
      addToast('Use a PNG, JPEG, or WebP evidence file.');
      return;
    }

    const formData = new FormData();
    formData.append('occurredAt', new Date().toISOString());
    if (expectedChecksum) {
      formData.append('expectedChecksum', expectedChecksum);
    }
    if (file) {
      formData.append('evidence', file);
    }

    await runAction(
      `attendance-${eventType}`,
      async () => {
        await apiRequest(`/attendance/${eventType}`, { method: 'POST', body: formData }, session);
        await risks.refetch();
        return true;
      },
      {
        successMessage: `Attendance ${eventType} recorded.`,
        errorMessage: (error) =>
          error instanceof Error ? error.message : `Attendance ${eventType} failed.`,
      },
    );
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[0.42fr_0.58fr]">
      <section className="shell-panel p-6">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Clock Actions</p>
        <p className="mt-3 font-ui text-sm text-black/60 dark:text-white/60">
          Attach optional evidence, validate its checksum locally, and feed the tamper-evident attendance chain.
        </p>
        <input
          className="field mt-5"
          value={expectedChecksum}
          onChange={(event) => {
            const nextChecksum = event.target.value;
            setExpectedChecksum(nextChecksum);
            if (file && localChecksum) {
              setFileStatus(
                nextChecksum.trim()
                  ? nextChecksum.trim() === localChecksum
                    ? 'Checksum matches the expected value.'
                    : 'Checksum does not match the expected value.'
                  : 'Checksum computed locally and ready to compare.',
              );
            }
          }}
          placeholder="Expected checksum"
        />
        <input
          className="field mt-4"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            void handleFileChange(event.target.files?.[0] ?? null);
          }}
        />
        {file ? (
          <div className="mt-4 rounded-2xl border border-black/10 px-4 py-3 font-ui text-sm dark:border-white/10">
            <p className="text-black/75 dark:text-white/75">{fileStatus}</p>
            {localChecksum ? (
              <p className="mt-2 break-all text-[11px] uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
                Local SHA-256: {localChecksum}
              </p>
            ) : null}
            {checksumRequired ? (
              <p className="mt-2 text-[11px] uppercase tracking-[0.12em] text-black/45 dark:text-white/45">
                Enter the expected checksum to submit this evidence file.
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="mt-4 flex gap-3">
          <button
            className="button-primary"
            disabled={checksumMismatch || checksumRequired || invalidEvidenceType || isPending('attendance-clock-in')}
            onClick={() => submit('clock-in')}
          >
            {isPending('attendance-clock-in') ? 'Clocking In...' : 'Clock In'}
          </button>
          <button
            className="button-secondary"
            disabled={checksumMismatch || checksumRequired || invalidEvidenceType || isPending('attendance-clock-out')}
            onClick={() => submit('clock-out')}
          >
            {isPending('attendance-clock-out') ? 'Clocking Out...' : 'Clock Out'}
          </button>
        </div>
      </section>

      <section className="shell-panel p-6">
        <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">Risk Alerts</p>
        <div className="mt-5">
          <QueryBoundary
            isPending={risks.isPending}
            isError={risks.isError}
            isEmpty={(risks.data?.length ?? 0) === 0}
            emptyTitle="No Active Alerts"
            emptyMessage="Clock activity is currently clear of risk alerts."
            errorMessage="Risk alerts could not be loaded right now."
            onRetry={() => void risks.refetch()}
            loading={<div className="skeleton h-48" />}
          >
            <div className="space-y-3">
              {(risks.data ?? []).map((risk) => (
                <div key={risk.id} className="rounded-2xl border border-black/10 px-4 py-3 dark:border-white/10">
                  <p className="font-display text-2xl">{risk.description}</p>
                  <p className="mt-2 font-ui text-sm text-black/55 dark:text-white/55">
                    {risk.username} · {formatReadableDateTime(risk.created_at)}
                  </p>
                </div>
              ))}
            </div>
          </QueryBoundary>
        </div>
      </section>
    </div>
  );
}
