import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomChatLine } from '../multiplayer/types';

type Props = {
  lines: RoomChatLine[];
  selfName: string;
  disabled?: boolean;
  onSend: (text: string) => void;
};

export default function MatchChat({ lines, selfName, disabled, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    log.scrollTop = log.scrollHeight;
  }, [lines.length]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft('');
  };

  return (
    <section className="match-chat" aria-label="Game chat">
      <div className="match-chat-log" ref={logRef} role="log" aria-live="polite">
        {lines.length ? lines.map(line => (
          <p key={line.id} className={line.name === selfName ? 'match-chat-line self' : 'match-chat-line'}>
            <b>{line.name}</b>
            <span>{line.text}</span>
          </p>
        )) : <p className="match-chat-empty">Say hello. Messages go to your opponent.</p>}
      </div>
      <form className="match-chat-form" onSubmit={submit}>
        <label className="qqurz-sr-only" htmlFor="qqurz-match-chat">Message your opponent</label>
        <input
          id="qqurz-match-chat"
          value={draft}
          maxLength={180}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="send"
          placeholder={disabled ? 'Reconnect to chat' : 'Type a message'}
          onChange={event => setDraft(event.target.value)}
        />
        <button type="submit" disabled={disabled || !draft.trim()}>Send</button>
      </form>
    </section>
  );
}
