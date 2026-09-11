import { useMemo, useState } from 'react';
import { PrimaryButton, SecondaryButton, SegmentedControl } from '../ui/controls';
import { playChessSound } from '../ui/sound';
import { AVATARS, loadProfile, randomUsername, saveProfile } from './profileStore';

type Props = { onBack: () => void };

export default function ProfileHub({ onBack }: Props) {
  const initial = useMemo(loadProfile, []);
  const [username, setUsername] = useState(initial?.username ?? randomUsername());
  const [avatar, setAvatar] = useState<string>(initial?.avatar ?? '♞');
  const [saved, setSaved] = useState(Boolean(initial));

  const save = () => {
    const profile = saveProfile(username, avatar, initial?.createdAt);
    setUsername(profile.username);
    setAvatar(profile.avatar);
    setSaved(true);
    playChessSound('start');
  };

  const avatarOptions = AVATARS.map(icon => ({ value: icon, label: icon, ariaLabel: `Use ${icon} as your chess icon` }));

  return (
    <div className="profile-page qqurz-content-page">
      <section className="page-heading-v14 compact">
        <SecondaryButton size="sm" leadingIcon="←" onClick={onBack}>Home</SecondaryButton>
        <span className="qqurz-kicker">QQURZ PROFILE</span>
        <h1>{saved ? `Welcome, ${username}.` : 'Create your player profile.'}</h1>
        <p>Choose a chess identity for rooms and tournaments. This first version is stored on this device; secure cloud sign-in and cash wallet funding come next.</p>
      </section>

      <section className="profile-card">
        <div className="profile-preview"><div className="profile-avatar large">{avatar}</div><div><span>PLAYER</span><strong>{username || 'Choose a username'}</strong><small>{saved ? 'Profile saved on this device' : 'Not saved yet'}</small></div></div>
        <label className="profile-field"><span>Username</span><input value={username} maxLength={24} onChange={event => { setUsername(event.target.value); setSaved(false); }} /></label>
        <SecondaryButton fullWidth onClick={() => { setUsername(randomUsername()); setSaved(false); }}>Generate random username</SecondaryButton>

        <div className="profile-avatar-picker">
          <span>Chess icon</span>
          <SegmentedControl
            value={avatar}
            options={avatarOptions}
            onChange={value => { setAvatar(value); setSaved(false); }}
            ariaLabel="Chess icon"
            size="md"
            className="profile-avatar-segments"
          />
        </div>

        <PrimaryButton fullWidth size="lg" onClick={save}>{saved ? 'Save changes' : 'Create profile'}</PrimaryButton>
      </section>

      <section className="wallet-card">
        <div><span className="qqurz-kicker">WALLET</span><h2>$0.00</h2><p>Real cash balances are not stored in the browser. Funding will be enabled only after secure account identity, server ledger, payment-provider controls, withdrawals and compliance checks are wired together.</p></div>
        <SecondaryButton disabled>Add money · coming next</SecondaryButton>
      </section>

      <section className="profile-roadmap">
        <article><span>01</span><b>Cloud account</b><p>Secure sign-in so your profile follows you between devices.</p></article>
        <article><span>02</span><b>Ratings & history</b><p>Track Chess960 games, tournament placements and verified results.</p></article>
        <article><span>03</span><b>Wallet infrastructure</b><p>Server-side ledger and payment controls before any real balance can be deposited.</p></article>
      </section>
    </div>
  );
}