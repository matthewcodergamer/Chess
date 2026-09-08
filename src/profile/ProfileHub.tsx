import { useMemo, useState } from 'react';
import { playChessSound } from '../ui/sound';

type Props = { onBack: () => void };

type Profile = {
  username: string;
  avatar: string;
  createdAt: number;
};

const PROFILE_KEY = 'qqurz:profile';
const AVATARS = ['♟', '♞', '♜', '♝', '♛', '♚', '960', 'Q'];
const FIRST = ['Rapid', 'Quiet', 'Royal', 'Green', 'Park', 'Knight', 'Castle', 'Tempo', 'Sharp', 'Freestyle'];
const SECOND = ['Rook', 'Pawn', 'Bishop', 'Knight', 'Queen', 'Gambit', 'Clock', 'Hustler', 'File', 'Fork'];

function randomUsername(): string {
  const first = FIRST[Math.floor(Math.random() * FIRST.length)];
  const second = SECOND[Math.floor(Math.random() * SECOND.length)];
  const number = 10 + Math.floor(Math.random() * 990);
  return `${first}${second}${number}`;
}

function loadProfile(): Profile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Profile;
    return value.username && value.avatar ? value : null;
  } catch { return null; }
}

export default function ProfileHub({ onBack }: Props) {
  const initial = useMemo(loadProfile, []);
  const [username, setUsername] = useState(initial?.username ?? randomUsername());
  const [avatar, setAvatar] = useState(initial?.avatar ?? '♞');
  const [saved, setSaved] = useState(Boolean(initial));

  const save = () => {
    const clean = username.replace(/[^A-Za-z0-9_ -]/g, '').trim().slice(0, 24) || randomUsername();
    const profile: Profile = { username: clean, avatar, createdAt: initial?.createdAt ?? Date.now() };
    window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    setUsername(clean);
    setSaved(true);
    playChessSound('start');
  };

  return (
    <div className="profile-page qqurz-content-page">
      <section className="page-heading-v14 compact">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">QQURZ PROFILE</span>
        <h1>{saved ? `Welcome, ${username}.` : 'Create your player profile.'}</h1>
        <p>Choose a chess identity for rooms and tournaments. This first version is stored on this device; secure cloud sign-in and cash wallet funding come next.</p>
      </section>

      <section className="profile-card">
        <div className="profile-preview"><div className="profile-avatar large">{avatar}</div><div><span>PLAYER</span><strong>{username || 'Choose a username'}</strong><small>{saved ? 'Profile saved on this device' : 'Not saved yet'}</small></div></div>
        <label className="profile-field"><span>Username</span><input value={username} maxLength={24} onChange={event => { setUsername(event.target.value); setSaved(false); }} /></label>
        <button className="secondary-clean profile-random" onClick={() => { setUsername(randomUsername()); setSaved(false); }}>Generate random username</button>

        <div className="profile-avatar-picker">
          <span>Chess icon</span>
          <div>{AVATARS.map(icon => <button key={icon} className={avatar === icon ? 'selected' : ''} onClick={() => { setAvatar(icon); setSaved(false); }}><span>{icon}</span></button>)}</div>
        </div>

        <button className="primary-black" onClick={save}>{saved ? 'Save changes' : 'Create profile'}</button>
      </section>

      <section className="wallet-card">
        <div><span className="qqurz-kicker">WALLET</span><h2>$0.00</h2><p>Real cash balances are not stored in the browser. Funding will be enabled only after secure account identity, server ledger, payment-provider controls, withdrawals and compliance checks are wired together.</p></div>
        <button disabled>Add money · coming next</button>
      </section>

      <section className="profile-roadmap">
        <article><span>01</span><b>Cloud account</b><p>Secure sign-in so your profile follows you between devices.</p></article>
        <article><span>02</span><b>Ratings & history</b><p>Track Chess960 games, tournament placements and verified results.</p></article>
        <article><span>03</span><b>Wallet infrastructure</b><p>Server-side ledger and payment controls before any real balance can be deposited.</p></article>
      </section>
    </div>
  );
}
