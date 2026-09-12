import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountToken } from '../account/client';
import {
  disableWebPush,
  enableWebPush,
  inspectWebPush,
  loadNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  sendFriendChallenge,
  syncExistingWebPushSubscription,
  type InAppNotification,
  type LocalNotification,
  type NotificationKind,
  type WebPushState,
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

function pushLabel(state: WebPushState | null): string {
  if (!state) return 'Checking…';
  if (!state.supported) return 'Unavailable';
  if (!state.configured) return 'Unavailable';
  if (state.ios && !state.standalone) return 'Home Screen required';
  if (state.permission === 'denied') return 'Blocked';
  return state.subscribed ? 'On' : 'Off';
}

function pushDescription(state: WebPushState | null): string {
  if (!state) return 'Checking browser support.';
  if (state.reason) return state.reason;
  if (state.subscribed) return 'QQURZ can alert this device when the app is closed.';
  return 'Get tournament, challenge, payout and security alerts when QQURZ is closed.';
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
  const [pushState, setPushState] = useState<WebPushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const firstLoad = useRef(true);
  const knownIds = useRef(new Set<string>());
  const shellRef = useRef<HTMLDivElement | null>(null);
  const roomCode = useMemo(currentRoomCode, [open]);

  const showToast = useCallback((toast: Toast) => {
    setToasts(current => [toast, ...current.filter(item => item.id !== toast.id)].slice(0, 3));
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== toast.id)), toast.priority === 'security' ? 8000 : 5200);
  }, []);

  const refreshPush = useCallback(async (sync = false) => {
    if (!accountToken()) { setPushState(null); return; }
    try {
      setPushState(sync ? await syncExistingWebPushSubscription() : await inspectWebPush());
    } catch (reason) {
      setPushMessage(reason instanceof Error ? reason.message : 'Could not check Web Push.');
      try { setPushState(await inspectWebPush()); } catch { setPushState(null); }
    }
  }, []);

  const refresh = useCallback(async (toastNew = true) => {
    const token = accountToken();
    setSignedIn(Boolean(token));
    if (!token) {
      setItems([]);
      setUnread(0);
      setPushState(null);
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
    if (accountToken()) void refreshPush(true);
    const timer = window.setInterval(() => void refresh(true), 15_000);
    const onAccount = () => { void refresh(false); void refreshPush(true); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void refresh(true);
        if (accountToken()) void refreshPush(true);
      }
    };
    window.addEventListener('qqurz:account-changed', onAccount);
    window.addEventListener('storage', onAccount);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('qqurz:account-changed', onAccount);
      window.removeEventListener('storage', onAccount);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh, refreshPush]);

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

  const togglePush = async () => {
    if (pushBusy || !pushState) return;
    setPushBusy(true);
    setPushMessage('');
    try {
      if (pushState.subscribed) {
        setPushState(await disableWebPush());
        setPushMessage('Web Push is off on this device. In-app notifications still work.');
      } else {
        setPushState(await enableWebPush());
        setPushMessage('Web Push is on for this device.');
      }
    } catch (reason) {
      setPushMessage(reason instanceof Error ? reason.message : 'Could not update Web Push.');
      await refreshPush(false);
    } finally {
      setPushBusy(false);
    }
  };

  const pushActionAvailable = Boolean(pushState?.supported && pushState.configured && !(pushState.ios && !pushState.standalone) && pushState.permission !== 'denied');

  return (
    <div className="qqurz-notification-center" ref={shellRef}>
      {signedIn && (
        <button
          className={`notification-bell ${unread ? 'has-unread' : ''}`}
          type="button"
          aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
          aria-expanded={open}
          onClick={() => { setOpen(value => !value); if (!open) { void refresh(false); void refreshPush(false); } }}
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

          <div className="notification-push-box">
            <div className="notification-push-copy">
              <span aria-hidden="true">⌁</span>
              <div><b>Web Push</b><small>{pushDescription(pushState)}</small></div>
              <strong>{pushLabel(pushState)}</strong>
            </div>
            {pushActionAvailable && <button type="button" onClick={() => void togglePush()} disabled={pushBusy}>{pushBusy ? 'Updating…' : pushState?.subscribed ? 'Turn off' : 'Enable on this device'}</button>}
            {pushMessage && <small className="notification-push-message" role="status">{pushMessage}</small>}
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
