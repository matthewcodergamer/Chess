import { useCallback, useEffect, useMemo, useState } from 'react';
import { accountToken } from '../account/client';
import { TournamentGridSkeleton } from '../ui/Skeletons';
import StateNotice from '../ui/StateNotice';
import {
  checkInEngineTournament,
  listEngineTournaments,
  loadEngineTournament,
  loadEngineTournamentMe,
  registerEngineTournament,
  type EngineTournamentDetail,
  type EngineTournamentMe,
  type EngineTournamentSummary,
} from './engineClient';

type Props = { onOpenGame: () => void };
type CapacityFilter = 'all' | 'other' | number;

const POWER_CAPACITIES = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096] as const;
const PAGE_SIZE = 12;

function formatName(value: EngineTournamentSummary['format']): string {
  if (value === 'swiss') return 'Swiss';
  if (value === 'round_robin') return 'Round robin';
  return 'Single elimination';
}

function statusLabel(value: EngineTournamentSummary['status']): string {
  return value.replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function startLabel(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
}

function playerStatus(event: EngineTournamentSummary, me: EngineTournamentMe | null | undefined): string {
  if (!me?.participant) return 'Not entered';
  if (me.seat) return 'Game ready';
  if (event.status === 'completed') return 'Finished';
  if (me.participant.status === 'eliminated') return 'Eliminated';
  if (me.participant.status === 'active') return 'Playing';
  if (me.participant.checkedInAt) return 'Checked in';
  return 'Registered';
}

function eventHasOpenSeats(event: EngineTournamentSummary): boolean {
  return event.registered < event.capacity && ['registration', 'check_in'].includes(event.status);
}

export default function TournamentMasterGrid({ onOpenGame }: Props) {
  const [events, setEvents] = useState<EngineTournamentSummary[]>([]);
  const [details, setDetails] = useState<Record<string, EngineTournamentDetail>>({});
  const [mine, setMine] = useState<Record<string, EngineTournamentMe | null>>({});
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [busyId, setBusyId] = useState('');
  const [inviteEventId, setInviteEventId] = useState('');
  const [inviteCodes, setInviteCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const signedIn = Boolean(accountToken());

  const loadList = useCallback(async () => {
    try {
      const value = await listEngineTournaments();
      setEvents(value.tournaments.filter(event => event.status !== 'cancelled'));
      setListError(false);
    } catch {
      setListError(true);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
    const timer = window.setInterval(() => void loadList(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadList]);

  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [capacityFilter]);

  const capacityCounts = useMemo(() => {
    const counts = new Map<number, number>();
    for (const event of events) counts.set(event.capacity, (counts.get(event.capacity) ?? 0) + 1);
    return counts;
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (capacityFilter === 'all') return events;
    if (capacityFilter === 'other') return events.filter(event => !POWER_CAPACITIES.includes(event.capacity as (typeof POWER_CAPACITIES)[number]));
    return events.filter(event => event.capacity === capacityFilter);
  }, [capacityFilter, events]);

  const visibleEvents = filteredEvents.slice(0, visibleCount);
  const visibleKey = visibleEvents.map(event => event.id).join('|');
  const nextOpenEvent = useMemo(() => events.find(eventHasOpenSeats) ?? null, [events]);

  useEffect(() => {
    let active = true;
    const loadVisibleRecords = async () => {
      const ids = visibleEvents.map(event => event.id);
      await Promise.all(ids.map(async id => {
        if (!details[id]) {
          try {
            const detail = await loadEngineTournament(id);
            if (active) setDetails(current => ({ ...current, [id]: detail }));
          } catch { /* one unavailable event should not hide the rest */ }
        }
        if (signedIn && !(id in mine)) {
          try {
            const me = await loadEngineTournamentMe(id);
            if (active) setMine(current => ({ ...current, [id]: me }));
          } catch {
            if (active) setMine(current => ({ ...current, [id]: null }));
          }
        }
      }));
    };
    void loadVisibleRecords();
    return () => { active = false; };
  }, [visibleKey, signedIn]);

  const refreshEvent = async (id: string) => {
    const [detail, me] = await Promise.all([
      loadEngineTournament(id),
      signedIn ? loadEngineTournamentMe(id).catch(() => null) : Promise.resolve(null),
    ]);
    setDetails(current => ({ ...current, [id]: detail }));
    setMine(current => ({ ...current, [id]: me }));
    await loadList();
  };

  const openAssignedGame = (me: EngineTournamentMe | null | undefined) => {
    const seat = me?.seat;
    if (!seat) return;
    try { sessionStorage.setItem(`qqurz:room-seat:${seat.code.toUpperCase()}`, JSON.stringify(seat)); } catch { /* optional */ }
    const url = new URL(window.location.href);
    url.searchParams.set('room', seat.code.toUpperCase());
    window.history.replaceState({}, '', url);
    onOpenGame();
  };

  const act = async (event: EngineTournamentSummary) => {
    if (!signedIn) {
      setMessage('Sign in to register for tournaments.');
      return;
    }
    let detail: EngineTournamentDetail;
    let me: EngineTournamentMe | null;
    try {
      detail = details[event.id] ?? await loadEngineTournament(event.id);
      me = mine[event.id] ?? await loadEngineTournamentMe(event.id).catch(() => null);
    } catch {
      setMessage('This tournament could not be refreshed. Your status was not changed. Retry the event in a moment.');
      return;
    }

    if (me?.seat) {
      openAssignedGame(me);
      return;
    }

    if (!me?.participant) {
      if (!['registration', 'check_in'].includes(event.status) || event.registered >= event.capacity) return;
      if (detail.entryRules.mode === 'invite' && inviteEventId !== event.id) {
        setInviteEventId(event.id);
        return;
      }
      setBusyId(event.id);
      try {
        await registerEngineTournament(event.id, inviteCodes[event.id] ?? '');
        setInviteEventId('');
        await refreshEvent(event.id);
        setMessage('Registration confirmed.');
      } catch {
        setMessage('Registration could not be completed. No seat was added. Check the invite code or retry while registration is still open.');
      } finally { setBusyId(''); }
      return;
    }

    if (detail.checkInRules.required && !me.participant.checkedInAt && event.status === 'check_in') {
      setBusyId(event.id);
      try {
        await checkInEngineTournament(event.id);
        await refreshEvent(event.id);
        setMessage('Check-in confirmed.');
      } catch {
        setMessage('Check-in could not be confirmed. Your tournament status was not changed. Retry before the check-in window closes.');
      } finally { setBusyId(''); }
    }
  };

  const actionLabel = (event: EngineTournamentSummary): string => {
    if (busyId === event.id) return 'Working…';
    if (!signedIn) return 'Sign in to enter';
    const detail = details[event.id];
    const me = mine[event.id];
    if (me?.seat) return 'Open game';
    if (!me?.participant) {
      if (event.registered >= event.capacity) return 'Full';
      if (!['registration', 'check_in'].includes(event.status)) return 'Registration closed';
      if (detail?.entryRules.mode === 'invite') return inviteEventId === event.id ? 'Register' : 'Enter code';
      return 'Register';
    }
    if (detail?.checkInRules.required && !me.participant.checkedInAt) return event.status === 'check_in' ? 'Check in' : 'Registered';
    if (event.status === 'completed') return 'Finished';
    if (me.participant.status === 'eliminated') return 'Eliminated';
    if (me.participant.checkedInAt) return 'Checked in';
    return 'Registered';
  };

  const actionEnabled = (event: EngineTournamentSummary): boolean => {
    if (!signedIn || busyId === event.id) return false;
    const detail = details[event.id];
    const me = mine[event.id];
    if (me?.seat) return true;
    if (!me?.participant) return eventHasOpenSeats(event);
    return Boolean(detail?.checkInRules.required && !me.participant.checkedInAt && event.status === 'check_in');
  };

  const otherCount = events.filter(event => !POWER_CAPACITIES.includes(event.capacity as (typeof POWER_CAPACITIES)[number])).length;

  if (listLoading) return <TournamentGridSkeleton/>;

  if (listError && events.length === 0) return (
    <StateNotice
      tone="error"
      icon="↻"
      eyebrow="TOURNAMENT AVAILABILITY"
      title="Tournament server unavailable"
      body={<p>QQURZ could not load the current seat inventory. No registration attempt was made.</p>}
      detail="Only real server tournament records are shown here, so the app will not invent placeholder seats while the service is unavailable."
      actions={[{ label: 'Retry availability', onClick: () => void loadList(), primary: true }]}
    />
  );

  const emptyBody = nextOpenEvent
    ? `${nextOpenEvent.title} has ${Math.max(0, nextOpenEvent.capacity - nextOpenEvent.registered).toLocaleString()} seat${nextOpenEvent.capacity - nextOpenEvent.registered === 1 ? '' : 's'} open now.`
    : 'The tournament server has not published the next registration window yet. QQURZ will show new seats here as soon as an organizer opens an event.';

  return (
    <section className="tournament-master-grid" aria-label="Tournament availability">
      <header className="master-grid-head">
        <div><span className="qqurz-kicker">MASTER GRID</span><h2>Choose a real event</h2><p>Every card below is a backend tournament record. Capacity buttons only filter those records; they never create imaginary events.</p></div>
        <span className="master-grid-live">● {events.length} live records</span>
      </header>

      {listError && <StateNotice className="compact" tone="warning" icon="↻" title="Couldn’t refresh tournament availability" body={<p>Showing the last tournament records that loaded successfully. Seat counts may have changed since then.</p>} actions={[{ label: 'Retry refresh', onClick: () => void loadList() }]} />}

      <div className="master-capacity-filter" role="group" aria-label="Filter tournaments by capacity">
        <button className={capacityFilter === 'all' ? 'active' : ''} onClick={() => setCapacityFilter('all')}><b>All</b><small>{events.length}</small></button>
        {POWER_CAPACITIES.map(capacity => <button key={capacity} className={capacityFilter === capacity ? 'active' : ''} onClick={() => setCapacityFilter(capacity)}><b>{capacity.toLocaleString()}</b><small>{capacityCounts.get(capacity) ?? 0}</small></button>)}
        {otherCount > 0 && <button className={capacityFilter === 'other' ? 'active' : ''} onClick={() => setCapacityFilter('other')}><b>Other</b><small>{otherCount}</small></button>}
      </div>

      {visibleEvents.length ? (
        <div className="master-event-cards">
          {visibleEvents.map(event => {
            const detail = details[event.id];
            const me = mine[event.id];
            const playerStatusResolved = !signedIn || event.id in mine;
            const filled = Math.max(0, Math.min(event.capacity, event.registered));
            const fill = event.capacity ? Math.round((filled / event.capacity) * 100) : 0;
            const prizePool = detail?.payout.mode && detail.payout.mode !== 'none' ? detail.payout.poolCents : null;
            const full = event.registered >= event.capacity;
            const alternative = nextOpenEvent && nextOpenEvent.id !== event.id ? nextOpenEvent : null;
            return (
              <article className="master-event-card" key={event.id}>
                <div className="master-event-card-head"><span className={`engine-status ${event.status}`}>{statusLabel(event.status)}</span><span>{event.capacity.toLocaleString()} seats</span></div>
                <h3>{event.title}</h3>
                <div className="master-seat-meter"><div><span>Seats filled</span><b>{filled.toLocaleString()} / {event.capacity.toLocaleString()}</b></div><div className="master-seat-track"><i style={{ width: `${fill}%` }} /></div></div>
                <dl className="master-event-facts">
                  <div><dt>Entry</dt><dd>{detail ? `${detail.entryRules.mode === 'invite' ? 'Invite · ' : ''}Free` : <span className="qqurz-skeleton-block qqurz-skeleton-line w-70" aria-label="Loading entry rules"/>}</dd></div>
                  <div><dt>Starts</dt><dd>{startLabel(event.startTime)}</dd></div>
                  <div><dt>Format</dt><dd>{formatName(event.format)}</dd></div>
                  <div><dt>Prize pool</dt><dd>{detail ? (prizePool === null ? '—' : money(prizePool)) : <span className="qqurz-skeleton-block qqurz-skeleton-line w-55" aria-label="Loading prize pool"/>}</dd></div>
                </dl>
                <div className="master-player-status"><span>Your status</span><b>{playerStatusResolved ? (signedIn ? playerStatus(event, me) : 'Sign in required') : <span className="qqurz-skeleton-block qqurz-skeleton-line w-55" aria-label="Loading your tournament status"/>}</b></div>
                {inviteEventId === event.id && !me?.participant && <input className="master-invite-input" aria-label={`Invite code for ${event.title}`} placeholder="Invite code" value={inviteCodes[event.id] ?? ''} onChange={input => setInviteCodes(current => ({ ...current, [event.id]: input.target.value }))} />}
                <button className={me?.seat || (!me?.participant && event.registered < event.capacity) ? 'primary-black master-event-action' : 'master-event-action'} disabled={!actionEnabled(event)} onClick={() => void act(event)}>{actionLabel(event)}</button>
                {full && <small className="master-event-recovery">Field full. {alternative ? `${alternative.title} has ${Math.max(0, alternative.capacity - alternative.registered).toLocaleString()} seats open now.` : 'No next registration window has been published yet; this card will update when the organizer opens another field.'}</small>}
              </article>
            );
          })}
        </div>
      ) : (
        <StateNotice
          tone="neutral"
          icon="♟"
          eyebrow="TOURNAMENT SEATS"
          title={capacityFilter === 'all' ? 'No tournament seats are open right now' : 'No events match this field size'}
          body={<p>{emptyBody}</p>}
          detail="Availability comes only from real tournament records; QQURZ does not display imaginary seats or opening times."
          actions={[
            ...(capacityFilter === 'all' ? [] : [{ label: 'Show all events', onClick: () => setCapacityFilter('all'), primary: true }]),
            { label: 'Retry availability', onClick: () => void loadList(), primary: capacityFilter === 'all' },
          ]}
        />
      )}

      {filteredEvents.length > visibleCount && <button className="master-show-more" onClick={() => setVisibleCount(current => current + PAGE_SIZE)}>Show more events</button>}
      {message && <div className="inline-message-v14 master-grid-message" role="status">{message}</div>}
    </section>
  );
}
