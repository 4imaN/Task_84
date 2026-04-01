import type { CommunityComment } from '../../lib/types';

type CommunityReportPanelProps = {
  reportTarget: CommunityComment;
  reportCategory: string;
  onReportCategoryChange: (value: string) => void;
  reportNotes: string;
  onReportNotesChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  isPending: boolean;
};

export function CommunityReportPanel({
  reportTarget,
  reportCategory,
  onReportCategoryChange,
  reportNotes,
  onReportNotesChange,
  onCancel,
  onSubmit,
  isPending,
}: CommunityReportPanelProps) {
  return (
    <div className="shell-panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-ui text-xs uppercase tracking-[0.25em] text-black/45 dark:text-white/45">
            Report Content
          </p>
          <p className="mt-2 font-ui text-sm text-black/60 dark:text-white/60">
            Reporting {reportTarget.authorName} for moderator review.
          </p>
        </div>
        <button className="button-secondary" disabled={isPending} onClick={onCancel}>
          Cancel
        </button>
      </div>
      <select className="field mt-5" value={reportCategory} onChange={(event) => onReportCategoryChange(event.target.value)}>
        <option value="ABUSE">Abuse</option>
        <option value="SPAM">Spam</option>
        <option value="MISINFORMATION">Misinformation</option>
        <option value="OTHER">Other</option>
      </select>
      <textarea
        className="field mt-4 min-h-28"
        placeholder="Required notes for the moderation queue"
        value={reportNotes}
        onChange={(event) => onReportNotesChange(event.target.value)}
      />
      <button className="button-primary mt-4" disabled={isPending} onClick={onSubmit}>
        {isPending ? 'Submitting...' : 'Submit Report'}
      </button>
    </div>
  );
}
