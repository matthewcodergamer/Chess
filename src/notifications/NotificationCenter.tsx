import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountToken } from '../account/client';
import {
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendFriendChallenge,
  type InAppNotification,
  type LocalNotification,
  type NotificationKind,
} from './client';

type Toast = { id: string; title: string; body: string; priority: 'normal' | 'important' | 'security' };

const KIND_ICON: Record<NotificationKind, string> = {
  tournament_starting: '♛',
  round_ready: '♟',
  friend_challenge: '♞',
  color_bid_result: '◐',
  color_bid_refund: '↩',
  payout: '$',
  security: '⌾',
};

function relativeTime(timestamp: number): string {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return 'Now';
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))}h`;
  if (delta < 7 * 24 * 60 * 60_000) return `${Math.floor(delta / (24 * 60 * 60_000))}d`;
  return new Date(timestamp).toLocaleDateString();
}

function currentRoomCode(): string {
  try {
    const code = new URL(window.location.href).searchParams.get('room')?.toUpperCase() ?? '';
    return /^[A-Z0-9]{6}$/.test(code) ? code : '';
  } catch {
    return '';
  }
}

function actionLabel(notification: InAppNotification): string | null {
  if (notification.action?.type === 'room') return 'Open game';
  return null;
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<InAppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [signedIn, setSignedIn] = useState(Boolean(accountToken()));
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [challengeName, setChallengeName] = useState('');
  const [challengeMessage, setChallengeMessage] = useState('');
  const [challengeBusy, setChallengeBusy] = useState(false);
  const firstLoad = useRef(true);
  const knownIds = useRef(new Set<string>());
  const shellRef = useRef<HTMLDivElement | null>(null);
  const roomCode = useMemo(currentRoomCode, [open]);

  const showToast = useCallback((toast: Toast) => {
    setToasts(current => [toast, ...current.filter(item => item.id !== toast.id)].slice(0, 3));
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), toast.priority === 'security' ? 8000 : 5200);
  }, []);

  const refresh = useCallback(async (toastNew = true) => {
    const token = accountToken();
    setSignedIn(Boolean(token));
    if (!token) {
      setItems([]);
      setUnread(0);
      knownIds.current.clear();
      firstLoad.current = true;
      return;
    }
    try {
      const inbox = await loadNotifications();
      setItems(inbox.notifications);
      setUnread(inbox.unread);
      setError('');
      if (!firstLoad.current && toastNew) {
        const fresh = inbox.notifications.filter(item => !knownIds.current.has(item.id));
        for (const item of fresh.slice(0, 3).reverse()) showToast({ id: item.id, title: item.title, body: item.body, priority: item.priority });
      }
      knownIds.current = new Set(inbox.notifications.map(item => item.id));
      firstLoad.current = false;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Notifications are temporarily unavailable.');
    }
  }, [showToast]);

  useEffect(() => {
    void refresh(false);
    const timer = window.setInterval(() => void refresh(true), 15_000);
    const onAccount = () => void refresh(false);
    const onVisibility = () => { if (document.visibilityState === 'visible') void refresh(true); };
    window.addEventListener('qqurz:account-changed', onAccount);
    window.addEventListener('storage', onAccount);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('qqurz:account-changed', onAccount);
      window.removeEventListener('storage', onAccount);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    const onLocal = (event: Event) => {
      const detail = (event as CustomEvent<LocalNotification>).detail;
      if (!detail?.title) return;
      showToast({ id: detail.id, title: detail.title, body: detail.body, priority: detail.priority });
    };
    window.addEventListener('qqurz:local-notification', onLocal);
    return () => window.removeEventListener('qqurz:local-notification', onLocal);
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    const onPointer = (event: PointerEvent) => {
      if (shellRef.current && !shellRef.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const readOne = async (item: InAppNotification) => {
    if (item.readAt === null) {
      setItems(current => current.map(value => value.id === item.id ? { ...value, readAt: Date.now() } : value));
      setUnread(value => Math.max(0, value - 1));
      try { await markNotificationRead(item.id); } catch { void refresh(false); }
    }
    if (item.action?.type === 'room') {
      const url = new URL(window.location.href);
      ['checkout', 'kind', 'item', 'session_id', 'color'].forEach(key => url.searchParams.delete(key));
      url.searchParams.set('room', item.action.roomCode.toUpperCase());
      window.location.assign(url.toString());
    }
  };

  const readAll = async () => {
    setItems(current => current.map(item => item.readAt === null ? { ...item, readAt: Date.now() } : item));
    setUnread(0);
    try { await markAllNotificationsRead(); } catch { void refresh(false); }
  };

  const challenge = async () => {
    if (!roomCode || !challengeName.trim() || challengeBusy) return;
    setChallengeBusy(true);
    setChallengeMessage('');
    try {
      const result = await sendFriendChallenge(challengeName.trim(), roomCode);
      if (result.delivered === false) setChallengeMessage(result.reason || 'That player has invite notifications turned off.');
      else {
        setChallengeMessage(`Challenge sent to ${result.target?.displayName || challengeName.trim()}.`);
        setChallengeName('');
      }
    } catch (reason) {
      setChallengeMessage(reason instanceof Error ? reason.message : 'Could not send the challenge.');
    } finally {
      setChallengeBusy(false);
    }
  };

  return (
    <div className="qqurz-notification-center" ref={shellRef}>
      {signedIn && (
        <button
          className={`notification-bell ${unread ? 'has-unread' : ''}`}
          type="button"
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value); if (!open) void refresh(false); }}
        >
          <span aria-hidden="true">♢</span>
          {unread > 0 && <b>{unread > 99 ? '99+' : unread}</b>}
        </button>
      )}

      {open && signedIn && (
        <section className="notification-panel" aria-label="Notifications">
          <div className="notification-panel-head">
            <div><span className="eyebrow">INBOX</span><h2>Notifications</h2></div>
            <button type="button" onClick={() => void readAll()} disabled={!unread}>Mark all read</button>
          </div>

          {roomCode && (
            <div className="notification-challenge-box">
              <div><b>Challenge a player</b><small>Send this room directly to a QQURZ username.</small></div>
              <div className="notification-challenge-row">
                <input value={challengeName} onChange={event => setChallengeName(event.target.value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20))} placeholder="Username" aria-label="Player username" />
                <button type="button" onClick={challenge} disabled={challengeBusy || !challengeName.trim()}>{challengeBusy ? 'Sending…' : 'Send'}</button>
              </div>
              {challengeMessage && <small className="notification-challenge-message">{challengeMessage}</small>}
            </div>
          )}

          {error && <p className="notification-error">{error}</p>}
          {!items.length && !error && <div className="notification-empty"><span>♞</span><b>You’re caught up.</b><small>Tournament rounds, challenges, payouts and security alerts will appear here.</small></div>}

          <div className="notification-list">
            {items.slice(0, 40).map(item => (
              <button key={item.id} type="button" className={`notification-item ${item.readAt === null ? 'unread' : ''} priority-${item.priority}`} onClick={() => void readOne(item)}>
                <span className="notification-kind-icon" aria-hidden="true">{KIND_ICON[item.kind]}</span>
                <span className="notification-copy"><b>{item.title}</b><small>{item.body}</small>{actionLabel(item) && <em>{actionLabel(item)}</em>}</span>
                <time dateTime={new Date(item.createdAt).toISOString()}>{relativeTime(item.createdAt)}</time>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className="notification-toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map(toast => (
          <div key={toast.id} className={`notification-toast priority-${toast.priority}`}>
            <span aria-hidden="true">{toast.priority === 'security' ? '⌾' : '♞'}</span>
            <div><b>{toast.title}</b><small>{toast.body}</small></div>
            <button type="button" aria-label="Dismiss notification" onClick={() => setToasts(current => current.filter(item => item.id !== toast.id))}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
