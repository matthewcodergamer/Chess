import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { DestructiveButton, PrimaryButton, SecondaryButton, SegmentedControl } from '../ui/controls';
import RatingIdentity from './RatingIdentity';
import {
  accountToken,
  blockPlayer,
  changeAccountPassword,
  deleteAccount,
  forgotPassword,
  listAccountSessions,
  listBlockedPlayers,
  loadAccount,
  loginAccount,
  logoutAccount,
  registerAccount,
  resendVerification,
  resetPassword,
  revokeAccountSession,
  revokeOtherSessions,
  socialProviderStatus,
  unblockPlayer,
  updateAccountNotifications,
  updateAccountPrivacy,
  updateAccountProfile,
  updateAccountSettings,
  verifyEmail,
  type Account,
  type AccountSession,
  type BlockedPlayer,
} from '../account/client';

const AVATARS = ['♟', '♞', '♜', '♝', '♛', '♚', '960', 'Q'] as const;
type Props = { onBack: () => void };
type AccountTab = 'overview' | 'history' | 'tournaments' | 'settings' | 'privacy' | 'sessions';
type AuthMode = 'login' | 'register' | 'forgot' | 'reset';

function flagFor(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '🌐';
  return String.fromCodePoint(...[...code].map(letter => 127397 + letter.charCodeAt(0)));
}

function dateLabel(value: number): string {
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
  catch { return new Date(value).toLocaleString(); }
}

function timeControl(baseMs: number, incrementMs: number): string {
  return `${Math.round(baseMs / 60_000)}+${Math.round(incrementMs / 1000)}`;
}

async function resizeAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Choose an image smaller than 8 MB.');
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.readAsDataURL(file);
  });
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error('Could not decode that image.'));
    value.src = source;
  });
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image resizing is unavailable in this browser.');
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sx = (image.naturalWidth - side) / 2;
  const sy = (image.naturalHeight - side) / 2;
  context.drawImage(image, sx, sy, side, side, 0, 0, 128, 128);
  return canvas.toDataURL('image/webp', .78);
}

function Avatar({ account, large = false }: { account: Pick<Account, 'avatar' | 'avatarImage' | 'displayName'>; large?: boolean }) {
  return account.avatarImage
    ? <img className={`account-avatar ${large ? 'large' : ''}`} src={account.avatarImage} alt={`${account.displayName} profile`} />
    : <span className={`account-avatar ${large ? 'large' : ''}`} aria-hidden="true">{account.avatar}</span>;
}

export default function ProfileHub({ onBack }: Props) {
  const query = useMemo(() => new URLSearchParams(window.location.search), []);
  const resetToken = query.get('reset') ?? '';
  const verifyToken = query.get('verify') ?? '';
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(Boolean(accountToken()));
  const [authMode, setAuthMode] = useState<AuthMode>(resetToken ? 'reset' : 'login');
  const [tab, setTab] = useState<AccountTab>('overview');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [avatar, setAvatar] = useState<string>('♞');
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [blocked, setBlocked] = useState<BlockedPlayer[]>([]);
  const [blockName, setBlockName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [socialStatus, setSocialStatus] = useState({ google: false, apple: false, ordinaryAuthRequired: true });

  const setMessage = (message: string) => { setError(''); setNotice(message); };
  const setFailure = (value: unknown) => { setNotice(''); setError(value instanceof Error ? value.message : 'Something went wrong.'); };

  const hydrateForm = (value: Account) => {
    setUsername(value.username);
    setDisplayName(value.displayName);
    setCountryCode(value.countryCode);
    setAvatar(value.avatar);
    setAvatarImage(value.avatarImage);
  };

  const refreshAccount = async () => {
    const value = await loadAccount();
    setAccount(value);
    hydrateForm(value);
    return value;
  };

  const refreshSecurity = async () => {
    const [sessionList, blockedList] = await Promise.all([listAccountSessions(), listBlockedPlayers()]);
    setSessions(sessionList);
    setBlocked(blockedList);
  };

  useEffect(() => {
    void socialProviderStatus().then(setSocialStatus).catch(() => undefined);
    if (verifyToken) {
      setBusy(true);
      void verifyEmail(verifyToken)
        .then(() => { setMessage('Email verified. You can sign in now.'); setAuthMode('login'); })
        .catch(setFailure)
        .finally(() => setBusy(false));
      return;
    }
    if (!accountToken()) { setLoading(false); return; }
    void refreshAccount().catch(() => setAccount(null)).finally(() => setLoading(false));
  }, [verifyToken]);

  useEffect(() => {
    if (!account) return;
    void refreshSecurity().catch(() => undefined);
  }, [account?.id]);

  const submitLogin = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const value = await loginAccount(identifier, password);
      setAccount(value); hydrateForm(value); setPassword(''); setMessage(`Welcome back, ${value.displayName}.`);
    } catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  const submitRegister = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await registerAccount({ email, password, username, displayName, countryCode, avatar, avatarImage });
      setAccount(result.account); hydrateForm(result.account); setPassword('');
      setMessage(result.verificationSent ? 'Account created. Check your email to verify it.' : 'Account created. Email delivery is not configured yet, so verification mail could not be sent.');
    } catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  const submitForgot = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { setMessage(await forgotPassword(email)); } catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  const submitReset = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try { await resetPassword(resetToken, password); setPassword(''); setAuthMode('login'); setMessage('Password changed. Sign in with your new password.'); }
    catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  const saveProfile = async () => {
    setBusy(true);
    try {
      const value = await updateAccountProfile({ username, displayName, countryCode, avatar, avatarImage });
      setAccount(value); hydrateForm(value); setMessage('Profile saved.');
    } catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  const doLogout = async () => {
    setBusy(true);
    try { await logoutAccount(); setAccount(null); setSessions([]); setBlocked([]); setMessage('Signed out.'); }
    catch (value) { setFailure(value); } finally { setBusy(false); }
  };

  if (loading) {
    return <div className="account-page qqurz-content-page"><div className="qqurz-loading" role="status"><span className="qqurz-button-spinner" /><span className="qqurz-button-sr">Loading account</span></div></div>;
  }

  if (!account) {
    return (
      <div className="account-page account-auth-page qqurz-content-page">
        <section className="account-auth-shell">
          <div className="account-auth-top"><SecondaryButton size="sm" leadingIcon="←" onClick={onBack}>Home</SecondaryButton><span className="qqurz-kicker">QQURZ ACCOUNT</span></div>
          <div className="account-auth-heading">
            <span className="account-auth-mark" aria-hidden="true">♞</span>
            <div><h1>{authMode === 'register' ? 'Create your player account.' : authMode === 'forgot' ? 'Recover your account.' : authMode === 'reset' ? 'Choose a new password.' : 'Sign in to QQURZ.'}</h1><p>Email/password remains the primary authentication route. Apple and Google are deliberately not allowed to replace it.</p></div>
          </div>

          {notice && <div className="account-message success" role="status">{notice}</div>}
          {error && <div className="account-message error" role="alert">{error}</div>}

          {authMode === 'login' && (
            <form className="account-form" onSubmit={submitLogin}>
              <label><span>Email or username</span><input required autoComplete="username" value={identifier} onChange={event => setIdentifier(event.target.value)} /></label>
              <label><span>Password</span><input required type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
              <PrimaryButton type="submit" size="lg" fullWidth loading={busy} loadingLabel="Signing in">Sign in</PrimaryButton>
              <div className="account-form-links"><button type="button" onClick={() => setAuthMode('forgot')}>Forgot password?</button><button type="button" onClick={() => setAuthMode('register')}>Create account</button></div>
            </form>
          )}

          {authMode === 'register' && (
            <form className="account-form" onSubmit={submitRegister}>
              <div className="account-form-grid">
                <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
                <label><span>Username</span><input required minLength={3} maxLength={20} autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} /></label>
              </div>
              <div className="account-form-grid">
                <label><span>Display name</span><input maxLength={40} value={displayName} onChange={event => setDisplayName(event.target.value)} placeholder={username || 'Your name'} /></label>
                <label><span>Country code</span><div className="account-country-input"><span>{flagFor(countryCode.toUpperCase())}</span><input maxLength={2} value={countryCode} onChange={event => setCountryCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="JM" /></div></label>
              </div>
              <label><span>Password</span><input required minLength={10} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /><small>At least 10 characters with letters and numbers.</small></label>
              <div className="account-avatar-picker"><span>Starting avatar</span><SegmentedControl value={avatar} options={AVATARS.map(value => ({ value, label: value, ariaLabel: `Use ${value} avatar` }))} onChange={setAvatar} ariaLabel="Account avatar" size="sm" /></div>
              <PrimaryButton type="submit" size="lg" fullWidth loading={busy} loadingLabel="Creating account">Create account</PrimaryButton>
              <SecondaryButton fullWidth onClick={() => setAuthMode('login')}>I already have an account</SecondaryButton>
            </form>
          )}

          {authMode === 'forgot' && (
            <form className="account-form" onSubmit={submitForgot}>
              <label><span>Email</span><input required type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
              <PrimaryButton type="submit" fullWidth loading={busy} loadingLabel="Sending reset link">Send reset link</PrimaryButton>
              <SecondaryButton fullWidth onClick={() => setAuthMode('login')}>Back to sign in</SecondaryButton>
            </form>
          )}

          {authMode === 'reset' && (
            <form className="account-form" onSubmit={submitReset}>
              <label><span>New password</span><input required minLength={10} type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} /></label>
              <PrimaryButton type="submit" fullWidth loading={busy} loadingLabel="Changing password">Change password</PrimaryButton>
            </form>
          )}

          <div className="account-social-gate" aria-label="Social sign-in status">
            <div><b>Apple</b><small>{socialStatus.apple ? 'Available' : 'Not enabled yet'}</small></div>
            <div><b>Google</b><small>{socialStatus.google ? 'Available' : 'Not enabled yet'}</small></div>
            <p>Social sign-in stays gated until ordinary QQURZ authentication, recovery and verification are operating reliably in production.</p>
          </div>
        </section>
      </div>
    );
  }


  return (
    <div className="account-page qqurz-content-page">
      <header className="account-header">
        <SecondaryButton size="sm" leadingIcon="←" onClick={onBack}>Home</SecondaryButton>
        <div className="account-identity">
          <Avatar account={account} large />
          <div><span className="qqurz-kicker">CHESS960 PLAYER</span><h1>{account.displayName}</h1><p>@{account.username} · {flagFor(account.countryCode)} {account.countryCode || 'Country not set'}</p></div>
        </div>
        <SecondaryButton size="sm" onClick={doLogout} loading={busy}>Log out</SecondaryButton>
      </header>

      {!account.emailVerifiedAt && (
        <section className="account-verification-banner"><div><b>Verify your email</b><small>{account.email}</small></div><SecondaryButton size="sm" onClick={async () => { setBusy(true); try { const sent = await resendVerification(); setMessage(sent ? 'Verification email sent.' : 'Email delivery is not configured on the server yet.'); } catch (value) { setFailure(value); } finally { setBusy(false); } }}>Resend</SecondaryButton></section>
      )}
      {notice && <div className="account-message success" role="status">{notice}</div>}
      {error && <div className="account-message error" role="alert">{error}</div>}

      <nav className="account-tabs" aria-label="Account sections">
        {([
          ['overview', 'Profile'], ['history', 'Games'], ['tournaments', 'Tournaments'], ['settings', 'Settings'], ['privacy', 'Privacy'], ['sessions', 'Devices'],
        ] as Array<[AccountTab, string]>).map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}
      </nav>

      {tab === 'overview' && (
        <div className="account-content-grid">
          <RatingIdentity account={account} />

          <section className="account-panel account-profile-editor">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">IDENTITY</span><h2>Player profile</h2></div><span>{flagFor(countryCode)}</span></div>
            <div className="account-avatar-editor">
              <div>{avatarImage ? <img className="account-avatar large" src={avatarImage} alt="Profile preview" /> : <span className="account-avatar large">{avatar}</span>}</div>
              <label className="account-file-button">Choose photo<input type="file" accept="image/png,image/jpeg,image/webp" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; try { setAvatarImage(await resizeAvatar(file)); } catch (value) { setFailure(value); } }} /></label>
              {avatarImage && <button className="account-text-button" onClick={() => setAvatarImage(null)}>Use chess avatar instead</button>}
            </div>
            <div className="account-form-grid">
              <label><span>Username</span><input value={username} maxLength={20} onChange={event => setUsername(event.target.value)} /></label>
              <label><span>Display name</span><input value={displayName} maxLength={40} onChange={event => setDisplayName(event.target.value)} /></label>
            </div>
            <label><span>Country code</span><div className="account-country-input"><span>{flagFor(countryCode)}</span><input value={countryCode} maxLength={2} onChange={event => setCountryCode(event.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} placeholder="JM" /></div></label>
            <div className="account-avatar-picker"><span>Chess avatar</span><SegmentedControl value={avatar} options={AVATARS.map(value => ({ value, label: value, ariaLabel: `Use ${value} avatar` }))} onChange={value => { setAvatar(value); setAvatarImage(null); }} ariaLabel="Chess avatar" size="sm" /></div>
            <PrimaryButton fullWidth onClick={saveProfile} loading={busy} loadingLabel="Saving profile">Save profile</PrimaryButton>
          </section>

          <section className="account-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">SECURITY</span><h2>Password</h2></div></div>
            <label><span>Current password</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
            <label><span>New password</span><input type="password" minLength={10} autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label>
            <PrimaryButton onClick={async () => { setBusy(true); try { await changeAccountPassword(currentPassword, newPassword); setCurrentPassword(''); setNewPassword(''); setMessage('Password changed. Other sessions were signed out.'); await refreshSecurity(); } catch (value) { setFailure(value); } finally { setBusy(false); } }} disabled={!currentPassword || newPassword.length < 10}>Change password</PrimaryButton>
          </section>
        </div>
      )}

      {tab === 'history' && (
        <section className="account-panel account-history-panel">
          <div className="account-panel-heading"><div><span className="qqurz-kicker">GAME HISTORY</span><h2>{account.gameHistory.length ? `${account.gameHistory.length} recent games` : 'No rated games yet'}</h2></div></div>
          <div className="account-history-list">
            {account.gameHistory.map(game => <article key={game.id}><span className={`account-result ${game.outcome}`}>{game.outcome === 'win' ? 'W' : game.outcome === 'loss' ? 'L' : 'D'}</span><div><b>{game.opponentName}</b><small>{dateLabel(game.playedAt)} · {timeControl(game.baseMs, game.incrementMs)} · Chess960 {game.ratingClass[0].toUpperCase() + game.ratingClass.slice(1)} · #{game.positionId ?? '—'}</small><p>{game.result}{game.rated ? ` · RD ${Math.round(game.ratingDeviationAfter)}` : ' · Unrated'}</p></div><strong>{Math.round(game.ratingAfter)}{game.rated ? ` ${Math.round(game.ratingAfter - game.ratingBefore) >= 0 ? '+' : ''}${Math.round(game.ratingAfter - game.ratingBefore)}` : ''}</strong></article>)}
            {!account.gameHistory.length && <div className="account-empty"><span>♟</span><b>Your completed online games will appear here.</b><small>Ratings and results are written by the server, not by the browser.</small></div>}
          </div>
        </section>
      )}

      {tab === 'tournaments' && (
        <div className="account-content-grid">
          <section className="account-panel account-history-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">TOURNAMENT HISTORY</span><h2>Entries & placements</h2></div></div>
            <div className="account-history-list">{account.tournamentHistory.map(item => <article key={item.id}><span className="account-result tournament">♛</span><div><b>{item.name}</b><small>{dateLabel(item.registeredAt)} · {item.status.replace('_', ' ')}</small></div><strong>{item.placement ? `#${item.placement}` : '—'}</strong></article>)}{!account.tournamentHistory.length && <div className="account-empty"><span>♛</span><b>No tournament entries yet.</b><small>Verified tournament registration and final placements will collect here.</small></div>}</div>
          </section>
          <section className="account-panel account-history-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">TROPHY CABINET</span><h2>Placements</h2></div></div>
            <div className="account-trophy-grid">{account.trophies.map(trophy => <article key={trophy.id}><span>{trophy.placement === 1 ? '♛' : trophy.placement === 2 ? '♜' : '♝'}</span><b>{trophy.title}</b><small>{dateLabel(trophy.awardedAt)}</small></article>)}{!account.trophies.length && <div className="account-empty"><span>♔</span><b>No trophies yet.</b><small>Top tournament placements will be awarded by the server.</small></div>}</div>
          </section>
        </div>
      )}

      {tab === 'settings' && (
        <div className="account-content-grid">
          <section className="account-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">ACCOUNT SETTINGS</span><h2>Language & timezone</h2></div></div>
            <label><span>Language</span><select value={account.settings.language} onChange={async event => { try { const settings = await updateAccountSettings({ language: event.target.value }); setAccount({ ...account, settings }); } catch (value) { setFailure(value); } }}><option value="en">English</option></select></label>
            <label><span>Timezone</span><input value={account.settings.timezone} onChange={event => setAccount({ ...account, settings: { ...account.settings, timezone: event.target.value } })} onBlur={async event => { try { const settings = await updateAccountSettings({ timezone: event.target.value }); setAccount({ ...account, settings }); } catch (value) { setFailure(value); } }} placeholder="auto" /></label>
          </section>
          <section className="account-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">NOTIFICATIONS</span><h2>What QQURZ can notify you about</h2></div></div>
            {([
              ['gameInvites', 'Game invites'], ['tournamentUpdates', 'Tournament updates'], ['results', 'Results & placements'], ['productUpdates', 'Product updates'],
            ] as const).map(([key, label]) => <label className="account-toggle" key={key}><span><b>{label}</b></span><input type="checkbox" checked={account.notifications[key]} onChange={async event => { const next = { ...account.notifications, [key]: event.target.checked }; setAccount({ ...account, notifications: next }); try { const notifications = await updateAccountNotifications({ [key]: event.target.checked }); setAccount(current => current ? { ...current, notifications } : current); } catch (value) { setFailure(value); } }} /></label>)}
          </section>
        </div>
      )}

      {tab === 'privacy' && (
        <div className="account-content-grid">
          <section className="account-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">PRIVACY</span><h2>Profile visibility</h2></div></div>
            <label><span>Who can see your profile</span><select value={account.privacy.profileVisibility} onChange={async event => { const value = event.target.value as Account['privacy']['profileVisibility']; try { const privacy = await updateAccountPrivacy({ profileVisibility: value }); setAccount({ ...account, privacy }); } catch (errorValue) { setFailure(errorValue); } }}><option value="public">Public</option><option value="players">Signed-in players</option><option value="private">Private</option></select></label>
            {([
              ['showCountry', 'Show country flag'], ['showHistory', 'Show game history'], ['allowChallenges', 'Allow direct challenges'],
            ] as const).map(([key, label]) => <label className="account-toggle" key={key}><span><b>{label}</b></span><input type="checkbox" checked={account.privacy[key]} onChange={async event => { try { const privacy = await updateAccountPrivacy({ [key]: event.target.checked }); setAccount({ ...account, privacy }); } catch (value) { setFailure(value); } }} /></label>)}
          </section>
          <section className="account-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">BLOCKED PLAYERS</span><h2>{blocked.length} blocked</h2></div></div>
            <div className="account-block-form"><input placeholder="Username" value={blockName} onChange={event => setBlockName(event.target.value)} /><SecondaryButton onClick={async () => { try { await blockPlayer(blockName); setBlockName(''); setBlocked(await listBlockedPlayers()); } catch (value) { setFailure(value); } }} disabled={!blockName.trim()}>Block</SecondaryButton></div>
            <div className="account-block-list">{blocked.map(player => <article key={player.id}>{player.avatarImage ? <img className="account-avatar" src={player.avatarImage} alt="" /> : <span className="account-avatar">{player.avatar}</span>}<div><b>{player.displayName}</b><small>@{player.username}</small></div><SecondaryButton size="sm" onClick={async () => { await unblockPlayer(player.username); setBlocked(await listBlockedPlayers()); }}>Unblock</SecondaryButton></article>)}{!blocked.length && <small className="account-muted">You have not blocked anyone.</small>}</div>
          </section>
        </div>
      )}

      {tab === 'sessions' && (
        <div className="account-content-grid">
          <section className="account-panel account-sessions-panel">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">SESSIONS & DEVICES</span><h2>Where you're signed in</h2></div><SecondaryButton size="sm" onClick={async () => { try { await revokeOtherSessions(); setSessions(await listAccountSessions()); setMessage('Other sessions signed out.'); } catch (value) { setFailure(value); } }}>Sign out others</SecondaryButton></div>
            <div className="account-session-list">{sessions.map(session => <article key={session.id}><span className={`session-dot ${session.current ? 'current' : ''}`} /><div><b>{session.deviceName}{session.current ? ' · This device' : ''}</b><small>Last active {dateLabel(session.lastSeenAt)}{session.ipPrefix ? ` · ${session.ipPrefix}` : ''}</small></div><SecondaryButton size="sm" onClick={async () => { const result = await revokeAccountSession(session.id); if (result.currentRevoked) { setAccount(null); return; } setSessions(await listAccountSessions()); }}>Sign out</SecondaryButton></article>)}</div>
          </section>

          <section className="account-panel account-danger-zone">
            <div className="account-panel-heading"><div><span className="qqurz-kicker">DANGER ZONE</span><h2>Delete account</h2></div></div>
            <p>This permanently removes your QQURZ login, profile, settings, sessions and stored account history. This action cannot be undone.</p>
            <label><span>Password</span><input type="password" value={deletePassword} onChange={event => setDeletePassword(event.target.value)} /></label>
            <label><span>Type DELETE</span><input value={deleteConfirm} onChange={event => setDeleteConfirm(event.target.value)} /></label>
            <DestructiveButton disabled={!deletePassword || deleteConfirm !== 'DELETE'} onClick={async () => { setBusy(true); try { await deleteAccount(deletePassword); setAccount(null); setMessage('Account deleted.'); } catch (value) { setFailure(value); } finally { setBusy(false); } }}>Delete my account</DestructiveButton>
          </section>
        </div>
      )}
    </div>
  );
}
