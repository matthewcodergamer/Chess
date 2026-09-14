import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AdminApiError,
  clearAdminCapability,
  loadOperations,
  storeAdminCapability,
  storedAdminCapability,
  type OperationsSnapshot,
  type OpsAudit,
  type OpsGame,
  type OpsReport,
  type OpsWebhook,
} from './client';

type Section = 'overview' | 'games' | 'players' | 'tournaments' | 'money' | 'integrity' | 'accounts' | 'webhooks' | 'audit';

const sections: Array<{ id: Section; label: string; short: string }> = [
  { id: 'overview', label: 'Overview', short: 'OV' },
  { id: 'games', label: 'Games', short: 'GM' },
  { id: 'players', label: 'Players', short: 'PL' },
  { id: 'tournaments', label: 'Tournaments', short: 'TR' },
  { id: 'money', label: 'Money', short: '$' },
  { id: 'integrity', label: 'Integrity', short: 'IN' },
  { id: 'accounts', label: 'Accounts', short: 'AC' },
  { id: 'webhooks', label: 'Webhooks', short: 'WH' },
  { id: 'audit', label: 'Audit log', short: 'AU' },
];

function formatDate(value: number | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(value);
}

function formatAge(ms: number | null | undefined): string {
  const value = Math.max(0, Number(ms ?? 0));
  if (value < 1_000) return '<1s';
  if (value < 60_000) return `${Math.floor(value / 1_000)}s`;
  if (value < 3_600_000) return `${Math.floor(value / 60_000)}m`;
  if (value < 86_400_000) return `${Math.floor(value / 3_600_000)}h`;
  return `${Math.floor(value / 86_400_000)}d`;
}

function money(cents: number | null | undefined, currency = 'USD'): string {
  const amount = Number(cents ?? 0) / 100;
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount); }
  catch { return `${currency} ${amount.toFixed(2)}`; }
}

function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  const value = status.toLowerCase();
  if (['active', 'running', 'captured', 'posted', 'paid', 'succeeded', 'processed', 'online', 'complete', 'completed'].includes(value)) return 'ok';
  if (['failed', 'rejected', 'disabled', 'action_required', 'escalated', 'stuck'].includes(value)) return 'bad';
  if (['pending', 'review', 'submitted', 'paused', 'away', 'triaged', 'reviewing', 'requires_action', 'registration'].includes(value)) return 'warn';
  return 'neutral';
}

function StatusChip({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  return <span className={`ops-chip ops-chip--${tone ?? statusTone(String(children))}`}>{children}</span>;
}

function Metric({ label, value, attention = false, detail }: { label: string; value: ReactNode; attention?: boolean; detail?: string }) {
  return (
    <article className={`ops-metric${attention ? ' ops-metric--attention' : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="ops-empty"><strong>{title}</strong><span>{detail}</span></div>;
}

function TableFrame({ title, detail, children, count }: { title: string; detail?: string; children: ReactNode; count?: number }) {
  return (
    <section className="ops-panel">
      <header className="ops-panel__header">
        <div><h2>{title}</h2>{detail && <p>{detail}</p>}</div>
        {typeof count === 'number' && <span className="ops-count">{count.toLocaleString()}</span>}
      </header>
      <div className="ops-table-wrap">{children}</div>
    </section>
  );
}

function HealthPanel({ snapshot }: { snapshot: OperationsSnapshot }) {
  const { health } = snapshot;
  const canonical = health.canonicalData;
  return (
    <section className="ops-health" aria-label="Server health">
      <div className="ops-health__lead">
        <span className={`ops-health__dot ${health.overall ? 'is-ok' : 'is-bad'}`} aria-hidden="true" />
        <div>
          <strong>{health.overall ? 'Systems reporting normally' : 'Partial operations visibility'}</strong>
          <span>Generated {formatDate(snapshot.generatedAt)}</span>
        </div>
      </div>
      <div className="ops-health__services">
        <StatusChip tone={canonical.reachable && canonical.ok ? 'ok' : 'bad'}>Data {canonical.reachable && canonical.ok ? 'healthy' : 'degraded'}</StatusChip>
        <StatusChip tone={health.matchmaking.reachable ? 'ok' : 'bad'}>Realtime {health.matchmaking.reachable ? 'reachable' : 'unavailable'}</StatusChip>
        <StatusChip tone={health.services.payments ? 'ok' : 'bad'}>Payments</StatusChip>
        <StatusChip tone={health.services.integrity ? 'ok' : 'bad'}>Integrity</StatusChip>
        <StatusChip tone={health.services.notifications ? 'ok' : 'bad'}>Notifications</StatusChip>
        <span className="ops-health__meta">Schema v{String(canonical.schemaVersion ?? '?')} · {Number(canonical.tables ?? 0)} tables · integrity {String(canonical.integrity ?? 'unknown')}</span>
      </div>
    </section>
  );
}

function GamesTable({ games, stuckOnly = false }: { games: OpsGame[]; stuckOnly?: boolean }) {
  const visible = stuckOnly ? games.filter(game => game.stuck) : games;
  if (!visible.length) return <EmptyState title={stuckOnly ? 'No stuck games' : 'No active games'} detail={stuckOnly ? 'No current game has exceeded its activity threshold.' : 'No canonical game is currently active, paused, or waiting.'} />;
  return (
    <table className="ops-table">
      <thead><tr><th>Room / game</th><th>Players</th><th>Status</th><th>Moves</th><th>Last activity</th><th>Context</th></tr></thead>
      <tbody>{visible.map(game => (
        <tr key={game.id} className={game.stuck ? 'is-attention' : undefined}>
          <td><strong>{game.room_code || 'No room code'}</strong><small>{game.id}</small></td>
          <td>{game.players || 'Seats not projected yet'}</td>
          <td><StatusChip tone={game.stuck ? 'bad' : undefined}>{game.stuck ? 'stuck' : game.status}</StatusChip></td>
          <td>{Number(game.move_count || 0).toLocaleString()}</td>
          <td><strong>{formatAge(game.stale_ms)} ago</strong><small>{formatDate(game.last_activity_at)}</small></td>
          <td><span>{game.rated ? game.rating_pool || 'rated' : 'casual'}</span>{game.tournament_id && <small>Tournament {game.tournament_id}</small>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function ReportsTable({ reports }: { reports: OpsReport[] }) {
  if (!reports.length) return <EmptyState title="No reports in this view" detail="Nothing currently matches this operational queue." />;
  return (
    <table className="ops-table">
      <thead><tr><th>Report</th><th>Target</th><th>Category</th><th>Status</th><th>Priority</th><th>Updated</th></tr></thead>
      <tbody>{reports.map(report => (
        <tr key={report.id}>
          <td><strong>{report.id}</strong><small>{report.game_id ? `Game ${report.game_id}` : report.tournament_id ? `Tournament ${report.tournament_id}` : 'Account report'}</small></td>
          <td>{report.target_name || report.target_user_id || 'Unknown'}</td>
          <td><span>{report.category}</span><small className="ops-ellipsis" title={report.narrative}>{report.narrative || 'No narrative'}</small></td>
          <td><StatusChip>{report.status}</StatusChip></td>
          <td>{Number(report.priority || 0)}</td>
          <td>{formatDate(report.updated_at)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function WebhookTable({ rows }: { rows: OpsWebhook[] }) {
  if (!rows.length) return <EmptyState title="No webhook events" detail="No provider webhook outcome has been recorded in this view." />;
  return (
    <table className="ops-table">
      <thead><tr><th>Provider / event</th><th>Endpoint</th><th>Status</th><th>HTTP</th><th>Error</th><th>Received</th></tr></thead>
      <tbody>{rows.map(item => (
        <tr key={item.id}>
          <td><strong>{item.provider}</strong><small>{item.event_id || item.id}</small></td>
          <td>{item.endpoint}</td>
          <td><StatusChip>{item.status}</StatusChip></td>
          <td>{item.http_status || '—'}</td>
          <td className="ops-ellipsis" title={item.error || ''}>{item.error || '—'}</td>
          <td>{formatDate(item.received_at)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function AuditTable({ rows }: { rows: OpsAudit[] }) {
  if (!rows.length) return <EmptyState title="No audit events projected" detail="The append-only canonical audit log is currently empty." />;
  return (
    <table className="ops-table">
      <thead><tr><th>Event</th><th>Actor</th><th>Action</th><th>Entity</th><th>Request</th><th>Time</th></tr></thead>
      <tbody>{rows.map(item => (
        <tr key={item.event_id}>
          <td><strong>{item.event_id}</strong></td>
          <td><StatusChip tone="neutral">{item.actor_type}</StatusChip><small>{item.actor_user_id || 'system'}</small></td>
          <td>{item.action}</td>
          <td><strong>{item.entity_type}</strong><small>{item.entity_id}</small></td>
          <td>{item.request_id || '—'}</td>
          <td>{formatDate(item.created_at)}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

function Unlock({ onUnlock, error }: { onUnlock(secret: string): void; error: string | null }) {
  const [value, setValue] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = value.trim();
    if (next.length >= 24) onUnlock(next);
  };
  return (
    <main className="ops-lock">
      <section className="ops-lock__card">
        <div className="ops-brand"><span className="ops-brand__mark">Q</span><div><strong>QQURZ</strong><small>OPERATIONS</small></div></div>
        <p className="ops-kicker">PRIVILEGED CONSOLE</p>
        <h1>Operate the competitive platform.</h1>
        <p className="ops-lock__intro">This surface exposes live game, tournament, financial, moderation and system-health data. Use the operator capability configured on the realtime Worker.</p>
        <form onSubmit={submit}>
          <label htmlFor="ops-capability">Admin capability</label>
          <input id="ops-capability" type="password" autoComplete="off" spellCheck={false} value={value} onChange={event => setValue(event.target.value)} placeholder="Enter operator capability" minLength={24} required autoFocus />
          {error && <p className="ops-form-error" role="alert">{error}</p>}
          <button type="submit" className="ops-primary">Unlock operations</button>
        </form>
        <p className="ops-lock__note">The capability is kept in this tab’s session storage only. It is never placed in the URL or local storage.</p>
      </section>
    </main>
  );
}

export default function AdminConsole() {
  const [capability, setCapability] = useState(storedAdminCapability);
  const [snapshot, setSnapshot] = useState<OperationsSnapshot | null>(null);
  const [section, setSection] = useState<Section>('overview');
  const [loading, setLoading] = useState(Boolean(capability));
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const refresh = useCallback(async (background = false) => {
    if (!capability) return;
    background ? setRefreshing(true) : setLoading(true);
    const controller = new AbortController();
    try {
      const next = await loadOperations(capability, controller.signal);
      setSnapshot(next);
      setError(null);
      setAuthError(null);
    } catch (reason) {
      if (reason instanceof AdminApiError && reason.status === 401) {
        clearAdminCapability();
        setCapability('');
        setSnapshot(null);
        setAuthError('That operator capability was not accepted.');
      } else {
        setError(reason instanceof Error ? reason.message : 'Operations data could not be loaded.');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    return () => controller.abort();
  }, [capability]);

  useEffect(() => {
    if (!capability) return;
    void refresh(false);
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh(true);
    }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(true); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [capability, refresh]);

  const unlock = (secret: string) => {
    storeAdminCapability(secret);
    setCapability(secret);
    setAuthError(null);
  };
  const lock = () => {
    clearAdminCapability();
    setCapability('');
    setSnapshot(null);
    setError(null);
  };

  const metrics = useMemo(() => snapshot ? [
    ['Online players', snapshot.summary.onlinePlayers, false, `${snapshot.summary.queuedPlayers || 0} queued`],
    ['Active games', snapshot.summary.activeGames || 0, false, `${snapshot.summary.pausedGames || 0} paused`],
    ['Stuck games', snapshot.summary.stuckGames || 0, (snapshot.summary.stuckGames || 0) > 0, 'needs operator review'],
    ['Running events', snapshot.summary.runningTournaments || 0, false, `${snapshot.summary.registrations || 0} registrations`],
    ['Open reports', snapshot.summary.openReports || 0, (snapshot.summary.openReports || 0) > 0, 'fair-play / moderation'],
    ['Pending payouts', snapshot.summary.pendingPayouts || 0, (snapshot.summary.pendingPayouts || 0) > 0, `${snapshot.summary.pendingRefunds || 0} refunds pending`],
    ['Failed webhooks', snapshot.summary.failedWebhooks || 0, (snapshot.summary.failedWebhooks || 0) > 0, 'provider delivery failures'],
    ['Restricted accounts', snapshot.summary.disabledAccounts || 0, false, 'disabled / active sanctions'],
  ] as const : [], [snapshot]);

  if (!capability) return <Unlock onUnlock={unlock} error={authError} />;

  return (
    <div className="ops-app">
      <header className="ops-topbar">
        <div className="ops-brand"><span className="ops-brand__mark">Q</span><div><strong>QQURZ</strong><small>OPERATIONS</small></div></div>
        <div className="ops-topbar__right">
          {snapshot && <span className={`ops-live ${snapshot.health.overall ? 'is-ok' : 'is-bad'}`}><i aria-hidden="true" />{snapshot.health.overall ? 'Live' : 'Degraded'}</span>}
          <span className="ops-readonly">READ-ONLY</span>
          <button type="button" className="ops-icon-button" onClick={() => void refresh(true)} disabled={refreshing} aria-label="Refresh operations data">{refreshing ? '···' : '↻'}</button>
          <button type="button" className="ops-lock-button" onClick={lock}>Lock</button>
        </div>
      </header>

      <div className="ops-layout">
        <nav className="ops-sidebar" aria-label="Operations sections">
          <div className="ops-sidebar__label">CONTROL ROOM</div>
          {sections.map(item => <button key={item.id} type="button" onClick={() => setSection(item.id)} aria-current={section === item.id ? 'page' : undefined} className={section === item.id ? 'is-active' : undefined}><span>{item.short}</span><strong>{item.label}</strong></button>)}
          <div className="ops-sidebar__foot"><strong>No direct mutations</strong><span>Financial and account changes stay behind their domain workflows.</span></div>
        </nav>

        <main className="ops-content" id="ops-main">
          {loading && !snapshot && <div className="ops-loading" role="status"><span /><strong>Loading operations snapshot…</strong></div>}
          {error && <div className="ops-error" role="alert"><div><strong>Operations data is temporarily unavailable</strong><span>{error}</span></div><button type="button" onClick={() => void refresh(false)}>Retry</button></div>}

          {snapshot && <>
            <header className="ops-page-head">
              <div><p>COMPETITIVE PLATFORM</p><h1>{sections.find(item => item.id === section)?.label}</h1></div>
              <div className="ops-page-head__meta"><span>Auto-refresh 15s</span><span>Last snapshot {formatDate(snapshot.generatedAt)}</span></div>
            </header>
            <HealthPanel snapshot={snapshot} />

            {section === 'overview' && <>
              <section className="ops-metrics">{metrics.map(([label, value, attention, detail]) => <Metric key={label} label={label} value={value} attention={attention} detail={detail} />)}</section>
              <div className="ops-grid-2">
                <TableFrame title="Games needing attention" detail="Active/paused games beyond their activity threshold" count={snapshot.games.filter(game => game.stuck).length}><GamesTable games={snapshot.games} stuckOnly /></TableFrame>
                <TableFrame title="Failed webhooks" detail="Rejected or failed provider events" count={snapshot.webhooks.failed.length}><WebhookTable rows={snapshot.webhooks.failed.slice(0, 12)} /></TableFrame>
              </div>
              <TableFrame title="Open moderation queue" detail="Latest player reports and escalations" count={snapshot.moderation.reports.filter(report => ['open', 'triaged', 'reviewing'].includes(report.status)).length}><ReportsTable reports={snapshot.moderation.reports.filter(report => ['open', 'triaged', 'reviewing'].includes(report.status)).slice(0, 12)} /></TableFrame>
            </>}

            {section === 'games' && <>
              <section className="ops-metrics ops-metrics--compact">
                <Metric label="Active" value={snapshot.summary.activeGames || 0} />
                <Metric label="Paused" value={snapshot.summary.pausedGames || 0} />
                <Metric label="Stuck" value={snapshot.summary.stuckGames || 0} attention={(snapshot.summary.stuckGames || 0) > 0} />
              </section>
              <TableFrame title="Live canonical games" detail="Authoritative room projections; stuck status is based on last committed activity" count={snapshot.games.length}><GamesTable games={snapshot.games} /></TableFrame>
            </>}

            {section === 'players' && <>
              <section className="ops-metrics ops-metrics--compact">
                <Metric label="Online" value={snapshot.online.counts?.online || 0} />
                <Metric label="Away" value={snapshot.online.counts?.away || 0} />
                <Metric label="In game" value={snapshot.online.counts?.game || 0} />
                <Metric label="Matchmaking queue" value={snapshot.online.queueSize || 0} attention={(snapshot.online.queueSize || 0) > 20} />
              </section>
              <TableFrame title="Online players" detail="Live presence expires automatically; this is not an account directory" count={snapshot.online.players?.length || 0}>
                {!snapshot.online.players?.length ? <EmptyState title="Nobody is currently present" detail="No active presence record survived the realtime TTL." /> : <table className="ops-table"><thead><tr><th>Player</th><th>State</th><th>Room</th><th>Region</th><th>Last seen</th></tr></thead><tbody>{snapshot.online.players.map(player => <tr key={player.presenceId}><td><strong>{player.name}</strong><small>{player.accountId || 'Guest presence'}</small></td><td><StatusChip>{player.state}</StatusChip></td><td>{player.roomCode || '—'}</td><td>{player.region?.country || player.region?.continent || '—'}<small>{player.region?.colo || ''}</small></td><td>{formatAge(player.idleMs)} ago</td></tr>)}</tbody></table>}
              </TableFrame>
              <TableFrame title="Waiting matchmaking tickets" count={snapshot.online.waitingTickets?.length || 0}>
                {!snapshot.online.waitingTickets?.length ? <EmptyState title="Queue is clear" detail="No player is currently waiting for an opponent." /> : <table className="ops-table"><thead><tr><th>Ticket</th><th>Player</th><th>Wait</th><th>Account</th></tr></thead><tbody>{snapshot.online.waitingTickets.map(ticket => <tr key={ticket.id}><td>{ticket.id}</td><td>{ticket.name}</td><td>{formatAge(ticket.waitedMs)}</td><td>{ticket.accountId || 'Guest'}</td></tr>)}</tbody></table>}
              </TableFrame>
            </>}

            {section === 'tournaments' && <TableFrame title="Tournament operations" detail="Registration totals, check-in progress and refund counts from the canonical model" count={snapshot.tournaments.length}>
              {!snapshot.tournaments.length ? <EmptyState title="No tournaments projected" detail="Tournament data will appear after authoritative tournament activity is projected." /> : <table className="ops-table"><thead><tr><th>Tournament</th><th>Status</th><th>Format</th><th>Registrations</th><th>Check-in</th><th>Refunded</th><th>Round</th><th>Starts</th></tr></thead><tbody>{snapshot.tournaments.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td><StatusChip>{item.status}</StatusChip></td><td>{item.format}</td><td><strong>{Number(item.registration_total || 0)}</strong><small>{item.capacity ? `of ${item.capacity}` : 'no cap'}</small></td><td>{Number(item.checked_in_total || 0)}</td><td>{Number(item.refunded_total || 0)}</td><td>{item.current_round || '—'}</td><td>{formatDate(item.starts_at)}</td></tr>)}</tbody></table>}
            </TableFrame>}

            {section === 'money' && <>
              <section className="ops-status-strip">{snapshot.payments.transactionStates.map(item => <div key={item.status}><StatusChip>{item.status}</StatusChip><strong>{Number(item.count).toLocaleString()}</strong></div>)}</section>
              <div className="ops-grid-2">
                <TableFrame title="Refunds" detail="Visibility only — refund execution remains in Payments/Ledger" count={snapshot.payments.refunds.length}>{!snapshot.payments.refunds.length ? <EmptyState title="No refunds" detail="No canonical refund records are present." /> : <table className="ops-table"><thead><tr><th>Refund</th><th>Amount</th><th>Status</th><th>Provider</th><th>Created</th></tr></thead><tbody>{snapshot.payments.refunds.map(item => <tr key={item.id}><td><strong>{item.id}</strong><small>{item.reason || 'No reason supplied'}</small></td><td>{money(item.amount_cents, item.currency)}</td><td><StatusChip>{item.status}</StatusChip></td><td>{item.provider}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>}</TableFrame>
                <TableFrame title="Payout status" detail="Requested, review, submitted and completed withdrawals" count={snapshot.payments.payouts.length}>{!snapshot.payments.payouts.length ? <EmptyState title="No payouts" detail="No canonical payout records are present." /> : <table className="ops-table"><thead><tr><th>Account</th><th>Amount</th><th>Status</th><th>Provider</th><th>Requested</th></tr></thead><tbody>{snapshot.payments.payouts.map(item => <tr key={item.id}><td><strong>{item.display_name || item.username || item.user_id}</strong><small>{item.failure_reason || item.id}</small></td><td>{money(item.amount_cents, item.currency)}</td><td><StatusChip>{item.status}</StatusChip></td><td>{item.provider}</td><td>{formatDate(item.requested_at)}</td></tr>)}</tbody></table>}</TableFrame>
              </div>
              <TableFrame title="Payment intents" count={snapshot.payments.intents.length}>{!snapshot.payments.intents.length ? <EmptyState title="No payment intents" detail="No provider intents have been projected yet." /> : <table className="ops-table"><thead><tr><th>Intent</th><th>Purpose</th><th>Amount</th><th>Status</th><th>Provider</th><th>Updated</th></tr></thead><tbody>{snapshot.payments.intents.map(item => <tr key={item.id}><td><strong>{item.id}</strong><small>{item.user_id || 'No linked user'}</small></td><td>{item.purpose}</td><td>{money(item.amount_cents, item.currency)}</td><td><StatusChip>{item.status}</StatusChip></td><td>{item.provider}</td><td>{formatDate(item.updated_at)}</td></tr>)}</tbody></table>}</TableFrame>
              <TableFrame title="Ledger transactions" detail="Append-only canonical transaction state" count={snapshot.payments.transactions.length}>{!snapshot.payments.transactions.length ? <EmptyState title="No ledger transactions" detail="The canonical ledger transaction view is empty." /> : <table className="ops-table"><thead><tr><th>Transaction</th><th>Type / purpose</th><th>Reference</th><th>Status</th><th>Sequence</th><th>Created</th></tr></thead><tbody>{snapshot.payments.transactions.map(item => <tr key={item.id}><td>{item.id}</td><td><strong>{item.transaction_type}</strong><small>{item.purpose}</small></td><td>{item.reference || '—'}</td><td><StatusChip>{item.status}</StatusChip></td><td>{item.sequence ?? '—'}</td><td>{formatDate(item.created_at)}</td></tr>)}</tbody></table>}</TableFrame>
            </>}

            {section === 'integrity' && <>
              <TableFrame title="Disputed results" detail="Result/dispute reports tied to authoritative games" count={snapshot.moderation.disputedResults.length}><ReportsTable reports={snapshot.moderation.disputedResults} /></TableFrame>
              <TableFrame title="Reports & moderation queue" count={snapshot.moderation.reports.length}><ReportsTable reports={snapshot.moderation.reports} /></TableFrame>
            </>}

            {section === 'accounts' && <TableFrame title="Restricted accounts" detail="Disabled accounts and active ban/suspension records" count={snapshot.moderation.bannedAccounts.length}>
              {!snapshot.moderation.bannedAccounts.length ? <EmptyState title="No restricted accounts projected" detail="No disabled account or active ban/suspension is present in the canonical view." /> : <table className="ops-table"><thead><tr><th>Account</th><th>User status</th><th>Action</th><th>Reason</th><th>Start</th><th>End</th></tr></thead><tbody>{snapshot.moderation.bannedAccounts.map(item => <tr key={item.id}><td><strong>{item.display_name || item.username || item.id}</strong><small>{item.id}</small></td><td><StatusChip>{item.status}</StatusChip></td><td>{item.action ? <StatusChip tone="bad">{item.action}</StatusChip> : '—'}</td><td>{item.reason || '—'}</td><td>{formatDate(item.starts_at)}</td><td>{item.ends_at ? formatDate(item.ends_at) : item.action ? 'Indefinite' : '—'}</td></tr>)}</tbody></table>}
            </TableFrame>}

            {section === 'webhooks' && <>
              <TableFrame title="Failed / rejected webhooks" detail="No raw provider payloads or signatures are retained here" count={snapshot.webhooks.failed.length}><WebhookTable rows={snapshot.webhooks.failed} /></TableFrame>
              <TableFrame title="Recent webhook outcomes" count={snapshot.webhooks.recent.length}><WebhookTable rows={snapshot.webhooks.recent} /></TableFrame>
            </>}

            {section === 'audit' && <TableFrame title="Append-only audit log" detail="Canonical security/business audit events" count={snapshot.audit.length}><AuditTable rows={snapshot.audit} /></TableFrame>}
          </>}
        </main>
      </div>
    </div>
  );
}
