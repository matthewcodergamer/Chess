import { useMemo, useState } from 'react';
import { PrimaryButton, SecondaryButton } from '../ui/controls';
import { loadProfile, randomUsername, sanitizeUsername, saveProfile } from '../profile/profileStore';
import {
  boardAppearanceLabel,
  saveOnboardingRecord,
  type BoardAppearance,
  type ChessExperience,
} from './preferences';

type Props = {
  initialBoardAppearance: BoardAppearance;
  initialSoundOn: boolean;
  onBoardAppearanceChange: (value: BoardAppearance) => void;
  onSoundChange: (value: boolean) => void;
  onComplete: () => void;
};

type ExperienceOption = {
  value: ChessExperience;
  title: string;
  note: string;
  mark: string;
};

type BoardOption = {
  value: BoardAppearance;
  title: string;
  note: string;
};

const EXPERIENCE_OPTIONS: ExperienceOption[] = [
  { value: 'new', title: 'New to chess', note: 'Start with the essentials and gentle practice.', mark: '01' },
  { value: 'basics', title: 'I know the basics', note: 'I know how the pieces move and how games end.', mark: '02' },
  { value: 'experienced', title: 'Experienced', note: 'I play regularly and understand chess strategy.', mark: '03' },
  { value: 'tournament', title: 'Tournament player', note: 'I am comfortable with competitive tournament play.', mark: '04' },
];

const BOARD_OPTIONS: BoardOption[] = [
  { value: 'walnut', title: 'Walnut', note: 'Warm wood with strong piece contrast.' },
  { value: 'tournament', title: 'Tournament green', note: 'Classic competitive board colors.' },
  { value: 'slate', title: 'Slate', note: 'Neutral, cool and low-distraction.' },
];

export default function FirstRunOnboarding({
  initialBoardAppearance,
  initialSoundOn,
  onBoardAppearanceChange,
  onSoundChange,
  onComplete,
}: Props) {
  const existingProfile = useMemo(loadProfile, []);
  const [step, setStep] = useState(0);
  const [experience, setExperience] = useState<ChessExperience | null>(null);
  const [boardAppearance, setBoardAppearance] = useState<BoardAppearance>(initialBoardAppearance);
  const [soundOn, setSoundOn] = useState(initialSoundOn);
  const [username, setUsername] = useState(existingProfile?.username ?? randomUsername());

  const chooseExperience = (value: ChessExperience) => {
    setExperience(value);
    setStep(1);
  };

  const chooseBoard = (value: BoardAppearance) => {
    setBoardAppearance(value);
    onBoardAppearanceChange(value);
    setStep(2);
  };

  const chooseSound = (value: boolean) => {
    setSoundOn(value);
    onSoundChange(value);
    setStep(3);
  };

  const finish = () => {
    if (!experience) return setStep(0);
    const profile = saveProfile(username, existingProfile?.avatar ?? '♞', existingProfile?.createdAt);
    setUsername(profile.username);
    saveOnboardingRecord({
      experience,
      boardAppearance,
      soundEnabled: soundOn,
      accountCreated: true,
    });
    onComplete();
  };

  return (
    <main className="qqurz-onboarding" aria-label="QQURZ first-run setup">
      <section className="onboarding-shell">
        <header className="onboarding-header">
          <div className="onboarding-brand" aria-label="QQURZ Chess">
            <span aria-hidden="true">♞</span>
            <div><b>QQURZ</b><small>Competitive Chess960</small></div>
          </div>
          <span className="onboarding-step-label">Step {step + 1} of 4</span>
        </header>

        <div className="onboarding-progress" aria-hidden="true">
          {[0, 1, 2, 3].map(index => <span key={index} className={index <= step ? 'active' : ''} />)}
        </div>

        <div className="onboarding-stage" key={step} aria-live="polite">
          {step === 0 && (
            <div className="onboarding-question">
              <span className="chess-eyebrow">YOUR CHESS</span>
              <h1>What is your chess experience?</h1>
              <p>We use this only to choose practice defaults and how much guidance to show. It is never used to secretly make matchmaking easier or harder.</p>
              <div className="onboarding-choice-list">
                {EXPERIENCE_OPTIONS.map(option => (
                  <button key={option.value} className="onboarding-choice-card" onClick={() => chooseExperience(option.value)}>
                    <span className="onboarding-choice-mark" aria-hidden="true">{option.mark}</span>
                    <span><b>{option.title}</b><small>{option.note}</small></span>
                    <span className="onboarding-choice-arrow" aria-hidden="true">›</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="onboarding-question">
              <span className="chess-eyebrow">BOARD</span>
              <h1>Which board feels best to you?</h1>
              <p>This becomes your default board appearance. You can change it later in Display settings.</p>
              <div className="onboarding-board-grid">
                {BOARD_OPTIONS.map(option => (
                  <button key={option.value} className={`onboarding-board-choice ${boardAppearance === option.value ? 'selected' : ''}`} onClick={() => chooseBoard(option.value)} aria-label={`Use ${option.title} board`}>
                    <span className={`onboarding-board-preview board-${option.value}`} aria-hidden="true" />
                    <span><b>{option.title}</b><small>{option.note}</small></span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="onboarding-question onboarding-question-centered">
              <span className="chess-eyebrow">SOUND</span>
              <h1>Do you want game sounds?</h1>
              <p>Move, capture, coin and physical-clock sounds can all be changed later.</p>
              <div className="onboarding-sound-grid">
                <button className={`onboarding-sound-choice ${soundOn ? 'selected' : ''}`} onClick={() => chooseSound(true)}>
                  <span aria-hidden="true">♪</span><b>Sound on</b><small>Hear moves and clock actions</small>
                </button>
                <button className={`onboarding-sound-choice ${!soundOn ? 'selected' : ''}`} onClick={() => chooseSound(false)}>
                  <span aria-hidden="true">—</span><b>Play quietly</b><small>No game audio</small>
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="onboarding-question onboarding-account-step">
              <span className="chess-eyebrow">PLAYER PROFILE</span>
              <h1>{existingProfile ? 'Confirm your player name.' : 'What should we call you?'}</h1>
              <p>Your name is shown in rooms and tournaments. This first account profile is stored on this device; secure cloud sign-in is not being faked here.</p>
              <div className="onboarding-account-card">
                <div className="onboarding-profile-preview">
                  <span aria-hidden="true">{existingProfile?.avatar ?? '♞'}</span>
                  <div><small>PLAYER</small><b>{sanitizeUsername(username) || 'Your name'}</b><em>{boardAppearanceLabel(boardAppearance)} board · sound {soundOn ? 'on' : 'off'}</em></div>
                </div>
                <label className="onboarding-name-field">
                  <span>Username</span>
                  <input value={username} maxLength={24} autoComplete="nickname" onChange={event => setUsername(event.target.value)} placeholder="Choose a username" />
                </label>
                <SecondaryButton fullWidth onClick={() => setUsername(randomUsername())}>Suggest another name</SecondaryButton>
                <PrimaryButton size="lg" fullWidth disabled={!sanitizeUsername(username)} onClick={finish}>Create profile & start playing</PrimaryButton>
              </div>
            </div>
          )}
        </div>

        {step > 0 && (
          <footer className="onboarding-footer">
            <SecondaryButton size="sm" leadingIcon="←" onClick={() => setStep(value => Math.max(0, value - 1))}>Back</SecondaryButton>
            <small>One choice at a time. Everything here can be changed later.</small>
          </footer>
        )}
      </section>
    </main>
  );
}
