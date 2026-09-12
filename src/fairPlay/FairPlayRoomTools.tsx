import { useMemo, useState } from 'react';
import { accountToken } from '../account/client';
import FairPlayActions from './FairPlayActions';
import { blockRoomPlayer, reportRoomPlayer, type FairPlayReportReason } from './client';

function currentRoomCode(): string {
  try {
    const value = new URL(window.location.href).searchParams.get('room')?.toUpperCase() ?? '';
    return /^[A-Z0-9]{6}$/.test(value) ? value : '';
  } catch {
    return '';
  }
}

export default function FairPlayRoomTools() {
  const roomCode = useMemo(currentRoomCode, [window.location.search]);
  const [message, setMessage] = useState('');
  const [opponentName, setOpponentName] = useState('Current opponent');

  if (!accountToken() || !roomCode) return null;

  const report = async (reason: FairPlayReportReason, details: string): Promise<boolean> => {
    setMessage('Sending report for moderator review…');
    try {
      const result = await reportRoomPlayer(roomCode, reason, details);
      setOpponentName(result.targetName || 'Current opponent');
      setMessage(`Report received for ${result.targetName || 'your opponent'}. It will be reviewed with the game evidence.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not submit the report.');
      return false;
    }
  };

  const block = async (): Promise<boolean> => {
    setMessage('Updating your competitive block list…');
    try {
      const result = await blockRoomPlayer(roomCode, true);
      setOpponentName(result.targetName || 'Current opponent');
      setMessage(`${result.targetName || 'That player'} is blocked from future direct competitive pairing with you.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not block that player.');
      return false;
    }
  };

  return (
    <div className="fair-play-room-tools">
      <FairPlayActions opponentName={opponentName} onReport={report} onBlock={block} />
      {message && <p className="fair-play-room-message" role="status">{message}</p>}
    </div>
  );
}
