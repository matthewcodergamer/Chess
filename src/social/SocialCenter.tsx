import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountToken, loadAccount, type Account } from '../account/client';
import { createRoom } from '../multiplayer/client';
import { sendFriendChallenge } from '../notifications/client';
import { createCustomTimeControl, timeControlFromPreset } from '../../shared/timeControl';
import { listEngineTournaments, loadEngineTournament, type EngineTournamentDetail, type EngineTournamentSummary } from '../tournaments/engineClient';
import {
  loadSocialOverview,
  lookupPlayers,
  removeFriend,
  requestFriend,
  respondFriendRequest,
  searchPlayers,
  setPlayerFollow,
  type RecentOpponent,
  type SocialOverview,
  type SocialPlayer,
} from './client';

type SocialTab = 'friends' | 'recent' | 'discover' | 'tournaments';

const EMPTY: SocialOverview = { friends: [], following: [], incomingRequests: [], outgoingRequests: [], recentOpponents: [] };

function roomCodeFromUrl(): string {
  try {
    const code = new URL(window.location.href).searchParams.get('room')?.toUpperCase() ?? '';
    return /^[A-Z0-9]{6}$/.test(code) ? code : '';
  } catch { return ''; }
}

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return 'Now';
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))}h ago`;
  return new Date(timestamp).toLocaleDateString();
}

function PlayerAvatar({ player }: { player: Pick<SocialPlayer, 'avatar' | 'avatarImage' | 'displayName'> }) {
  return player.avatarImage
    ? <img className="social-avatar" src={player.avatarImage} alt={`${player.displayName} profile`} />
    : <span className="social-avatar" aria-hidden="true">{player.avatar}</span>;
}

function playerMeta(player: SocialPlayer): string {
  if (!player.profileVisible) return `@${player.username} · Private profile`;
  const parts = [`@${player.username}`, `${player.rating} rating`];
  if (player.countryCode) parts.push(player.countryCode);
  return parts.join(' · ');
}

export default function SocialCenter() {
  const [account, setAccount] = useState<Account | null>(null);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<SocialTab>('friends');
  const [overview, setOverview] = useState<SocialOverview>(EMPTY);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SocialPlayer[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [events, setEvents] = useState<EngineTournamentSummary[]>([]);
  const [eventId, setEventId] = useState('');
  const [eventDetail, setEventDetail] = useState<EngineTournamentDetail | null>(null);
  const [participantProfiles, setParticipantProfiles] = useState<Record<string, SocialPlayer>>({});
  const shellRef = useRef<HTMLDivElement | null>(null);

  const signedIn = Boolean(accountToken() && account);
  const incoming = overview.incomingRequests.length;

  const refresh = useCallback(async () => {
    if (!accountToken()) { setAccount(null); setOverview(EMPTY); return; }
    try {
      const [nextAccount, nextOverview] = await Promise.all([loadAccount(), loadSocialOverview()]);
      setAccount(nextAccount);
      setOverview(nextOverview);
    } catch {
      setAccount(null);
      setOverview(EMPTY);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const onAccount = (event: Event) => {
      const next = (event as CustomEvent<Account>).detail;
      if (next?.id) setAccount(next);
      else void refresh();
    };
    const onStorage = () => void refresh();
    window.addEventListener('qqurz:account-changed', onAccount);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('qqurz:account-changed', onAccount);
      window.removeEventListener('storage', onStorage);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'discover' || query.trim().length < 2) { setSearch([]); return; }
    const timer = window.setTimeout(() => {
      void searchPlayers(query).then(setSearch).catch(error => setMessage(error instanceof Error ? error.message : 'Could not search players.'));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [open, query, tab]);

  useEffect(() => {
    if (!open || tab !== 'tournaments') return;
    void listEngineTournaments().then(result => {
      setEvents(result.tournaments);
      setEventId(current => current || result.tournaments[0]?.id || '');
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not load tournaments.'));
  }, [open, tab]);

  useEffect(() => {
    if (!open || tab !== 'tournaments' || !eventId) { setEventDetail(null); setParticipantProfiles({}); return; }
    void loadEngineTournament(eventId).then(async detail => {
      setEventDetail(detail);
      const accountIds = detail.participants.map(player => player.id.startsWith('p_') ? player.id.slice(2) : '').filter(Boolean);
      const profiles = await lookupPlayers(accountIds);
      setParticipantProfiles(Object.fromEntries(profiles.map(player => [player.id, player])));
    }).catch(error => setMessage(error instanceof Error ? error.message : 'Could not load tournament players.'));
  }, [eventId, open, tab]);

  const mutate = async (key: string, action: () => Promise<unknown>, success = '') => {
    setBusy(key); setMessage('');
    try {
      await action();
      await refresh();
      if (success) setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Player action failed.');
    } finally { setBusy(''); }
  };

  const invite = async (player: SocialPlayer, previous?: RecentOpponent['lastGame']) => {
    if (!account || !player.canChallenge) return;
    setBusy(`invite:${player.id}`); setMessage('');
    try {
      const existing = previous ? '' : roomCodeFromUrl();
      let code = existing;
      if (!code) {
        const control = previous
          ? createCustomTimeControl(previous.baseMs / 60_000, previous.incrementMs / 1_000)
          : timeControlFromPreset('10+5');
        const seat = await createRoom(account.displayName, control);
        code = seat.code.toUpperCase();
        try { sessionStorage.setItem(`qqurz:room-seat:${code}`, JSON.stringify(seat)); } catch { /* optional */ }
      }
      const result = await sendFriendChallenge(player.username, code);
      if (result.delivered === false) {
        setMessage(result.reason || `${player.displayName} is not accepting game-invite notifications.`);
        return;
      }
      setMessage(previous ? `Rematch invite sent to ${player.displayName}.` : `Game invite sent to ${player.displayName}.`);
      if (!existing) {
        const url = new URL(window.location.href);
        url.searchParams.set('room', code);
        window.location.assign(url.toString());
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create the game invite.');
    } finally { setBusy(''); }
  };

  const actions = (player: SocialPlayer, recent?: RecentOpponent['lastGame']) => (
    <div className="social-actions">
      {player.relationship.incomingRequest ? <>
        <button type="button" onClick={() => void mutate(`accept:${player.id}`, () => respondFriendRequest(player.id, 'accept'), `${player.displayName} is now a friend.`)}>Accept</button>
        <button type="button" className="quiet" onClick={() => void mutate(`decline:${player.id}`, () => respondFriendRequest(player.id, 'decline'))}>Decline</button>
      </> : player.relationship.friend ? (
        <button type="button" className="quiet" onClick={() => void mutate(`remove:${player.id}`, () => removeFriend(player.id), `Removed ${player.displayName} from friends.`)}>Friends ✓</button>
      ) : player.relationship.outgoingRequest ? (
        <button type="button" className="quiet" disabled>Requested</button>
      ) : (
        <button type="button" onClick={() => void mutate(`friend:${player.id}`, () => requestFriend(player.id), `Friend request sent to ${player.displayName}.`)}>Add friend</button>
      )}
      <button type="button" className="quiet" onClick={() => void mutate(`follow:${player.id}`, () => setPlayerFollow(player.id, !player.relationship.following))}>{player.relationship.following ? 'Following ✓' : 'Follow'}</button>
      <button type="button" className="quiet" disabled={!player.canChallenge || busy === `invite:${player.id}`} onClick={() => void invite(player, recent)}>{busy === `invite:${player.id}` ? 'Preparing…' : recent ? 'Rematch' : roomCodeFromUrl() ? 'Invite here' : 'Invite to game'}</button>
    </div>
  );

  const playerRow = (player: SocialPlayer, recent?: RecentOpponent['lastGame']) => (
    <article className="social-player-row" key={`${player.id}:${recent?.id ?? 'profile'}`}>
      <PlayerAvatar player={player} />
      <div className="social-player-copy">
        <b>{player.displayName}</b>
        <small>{playerMeta(player)}</small>
        {recent && <span>{relativeTime(recent.playedAt)} · {Math.round(recent.baseMs / 60_000)}+{Math.round(recent.incrementMs / 1000)} · {recent.outcome}</span>}
      </div>
      {actions(player, recent)}
    </article>
  );

  const selectedEvent = useMemo(() => events.find(event => event.id === eventId) ?? null, [eventId, events]);

  if (!signedIn) return null;

  return (
    <div className="qqurz-social-center" ref={shellRef}>
      <button className={`social-launcher ${incoming ? 'has-request' : ''}`} type="button" aria-label={incoming ? `Players, ${incoming} friend requests` : 'Players'} aria-expanded={open} onClick={() => { setOpen(value => !value); if (!open) void refresh(); }}>
        <span aria-hidden="true">♙♟</span>{incoming > 0 && <b>{incoming > 9 ? '9+' : incoming}</b>}
      </button>

      {open && <section className="social-panel" aria-label="Players">
        <header className="social-panel-head">
          <div><span className="eyebrow">PLAYERS</span><h2>People you play</h2></div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close players">×</button>
        </header>
        <nav className="social-tabs" aria-label="Player discovery sections">
          {([['friends', `Friends${incoming ? ` · ${incoming}` : ''}`], ['recent', 'Recent'], ['discover', 'Find'], ['tournaments', 'Tournaments']] as Array<[SocialTab, string]>).map(([value, label]) => <button type="button" key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setMessage(''); }}>{label}</button>)}
        </nav>

        {message && <div className="social-message" role="status">{message}</div>}

        {tab === 'friends' && <div className="social-section-stack">
          {overview.incomingRequests.length > 0 && <section><div className="social-section-title"><b>Friend requests</b><small>{overview.incomingRequests.length}</small></div>{overview.incomingRequests.map(player => playerRow(player))}</section>}
          <section><div className="social-section-title"><b>Friends</b><small>{overview.friends.length}</small></div>{overview.friends.length ? overview.friends.map(player => playerRow(player)) : <div className="social-empty"><b>No friends yet.</b><small>Find someone you know or add a recent opponent.</small></div>}</section>
          {overview.following.length > 0 && <section><div className="social-section-title"><b>Following</b><small>{overview.following.length}</small></div>{overview.following.map(player => playerRow(player))}</section>}
        </div>}

        {tab === 'recent' && <div className="social-section-stack"><section><div className="social-section-title"><b>Recent opponents</b><small>{overview.recentOpponents.length}</small></div>{overview.recentOpponents.length ? overview.recentOpponents.map(player => playerRow(player, player.lastGame)) : <div className="social-empty"><b>No recent opponents.</b><small>Completed signed-in online games will appear here for quick rematches.</small></div>}</section></div>}

        {tab === 'discover' && <div className="social-discover"><label><span>Find a player</span><input value={query} onChange={event => setQuery(event.target.value.slice(0, 40))} placeholder="Username or display name" autoComplete="off" /></label><small>Search starts after 2 characters. Private profiles and blocked players are excluded.</small>{query.trim().length >= 2 && <div className="social-section-stack"><section>{search.length ? search.map(player => playerRow(player)) : <div className="social-empty"><b>No visible players found.</b><small>Try a username or a more specific name.</small></div>}</section></div>}</div>}

        {tab === 'tournaments' && <div className="social-tournament-browser">
          <label><span>Tournament</span><select value={eventId} onChange={event => setEventId(event.target.value)}><option value="">Choose an event</option>{events.map(event => <option key={event.id} value={event.id}>{event.title} · {event.registered} players</option>)}</select></label>
          {selectedEvent && <small>{selectedEvent.registered}/{selectedEvent.capacity} registered · {selectedEvent.status.replaceAll('_', ' ')}</small>}
          {eventDetail && <div className="social-tournament-list">{eventDetail.participants.map(participant => {
            const accountId = participant.id.startsWith('p_') ? participant.id.slice(2) : '';
            const player = participantProfiles[accountId];
            return <article key={participant.id} className="social-tournament-row"><div><b>{participant.name}</b><small>{participant.rating} rating · {participant.status.replaceAll('_', ' ')}</small></div>{player ? actions(player) : <small>Profile private or unavailable</small>}</article>;
          })}{!eventDetail.participants.length && <div className="social-empty"><b>No participants yet.</b><small>Registered players will appear here.</small></div>}</div>}
        </div>}
      </section>}
    </div>
  );
}
