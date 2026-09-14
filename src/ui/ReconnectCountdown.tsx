import { useEffect, useState } from 'react';

const RECONNECT_DISPLAY_SECONDS = 15;

export default function ReconnectCountdown({ active }: { active: boolean }) {
  const [seconds, setSeconds] = useState(RECONNECT_DISPLAY_SECONDS);

  useEffect(() => {
    if (!active) {
      setSeconds(RECONNECT_DISPLAY_SECONDS);
      return;
    }
    setSeconds(RECONNECT_DISPLAY_SECONDS);
    const timer = window.setInterval(() => {
      setSeconds(current => current > 0 ? current - 1 : 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  if (!active) return null;
  return (
    <small className="match-reconnect-countdown" role="status" aria-live="polite">
      {seconds > 0 ? `Reconnect check in ${seconds}s` : 'Still waiting for reconnect'}
    </small>
  );
}
