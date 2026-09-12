import { useState } from 'react';
import type { FairPlayReportReason } from './client';

type Props = {
  opponentName: string;
  disabled?: boolean;
  onReport: (reason: FairPlayReportReason, details: string) => Promise<boolean>;
  onBlock: () => Promise<boolean>;
};

const REASONS: Array<{ value: FairPlayReportReason; label: string }> = [
  { value: 'engine_assistance', label: 'Possible engine / outside assistance' },
  { value: 'stalling', label: 'Intentional stalling' },
  { value: 'disconnect_abuse', label: 'Disconnect / abandon abuse' },
  { value: 'sandbagging', label: 'Possible rating manipulation / sandbagging' },
  { value: 'multi_account', label: 'Possible multiple-account abuse' },
  { value: 'abuse', label: 'Harassment / abusive behavior' },
  { value: 'other', label: 'Other fair-play concern' },
];

export default function FairPlayActions({ opponentName, disabled, onReport, onBlock }: Props) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<FairPlayReportReason>('engine_assistance');
  const [details, setDetails] = useState('');
  const [reported, setReported] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [busy, setBusy] = useState<'report' | 'block' | ''>('');

  const submit = async () => {
    setBusy('report');
    const ok = await onReport(reason, details.trim()).catch(() => false);
    setBusy('');
    if (!ok) return;
    setReported(true);
    setOpen(false);
  };

  const block = async () => {
    setBusy('block');
    const ok = await onBlock().catch(() => false);
    setBusy('');
    if (ok) setBlocked(true);
  };

  return (
    <section className="fair-play-actions" aria-label={`Fair-play actions for ${opponentName}`}>
      <div className="fair-play-actions-head">
        <div><span className="eyebrow">FAIR PLAY</span><b>{opponentName}</b></div>
        <div className="fair-play-action-buttons">
          <button type="button" onClick={() => setOpen(value => !value)} disabled={disabled || reported || Boolean(busy)}>{reported ? 'Reported' : busy === 'report' ? 'Sending…' : 'Report player'}</button>
          <button type="button" onClick={() => void block()} disabled={disabled || blocked || Boolean(busy)}>{blocked ? 'Blocked' : busy === 'block' ? 'Blocking…' : 'Block player'}</button>
        </div>
      </div>
      {open && (
        <div className="fair-play-report-form">
          <label>
            <span>Reason</span>
            <select value={reason} onChange={event => setReason(event.target.value as FairPlayReportReason)} disabled={Boolean(busy)}>
              {REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span>What happened? <small>Optional</small></span>
            <textarea value={details} maxLength={800} rows={3} onChange={event => setDetails(event.target.value)} placeholder="Add useful context for the moderator. Avoid guesses presented as facts." disabled={Boolean(busy)} />
          </label>
          <div className="fair-play-report-submit">
            <small>Reports are reviewed with game evidence. A report does not automatically penalize the other player.</small>
            <button type="button" onClick={() => void submit()} disabled={Boolean(busy)}>{busy === 'report' ? 'Sending…' : 'Send report'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
