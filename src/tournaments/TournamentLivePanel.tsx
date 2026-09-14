import { useCallback, useEffect, useMemo, useState } from 'react';
import StateNotice from '../ui/StateNotice';
import TournamentSpectatorBoard from './TournamentSpectatorBoard';
import { loadTournamentLiveView, type TournamentLiveView } from './viewingClient';

type Props = {
  tournamentId: string;
  tournamentName: string;
};

function rating(value: number | null): string {
  return value === null ? 'Unrated' : String(value);
}

function score(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export default function TournamentLivePanel({ tournamentId, tournamentName }: Props) {
  const [view, setView] = useState<TournamentLiveView>({
    tournamentId,
    games: [],
    standings: [],
    liveGames: 0,
    completedGames: 0,
    updatedAt: 0,
    serverNow: Date.now(),
  });
  const [selectedRoom, setSelectedRoom] = useState('');
  const [refreshFailed, setRefreshFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await loadTournamentLiveView(tournamentId);
      setView(next);
      setRefreshFailed(false);
      setSelectedRoom(current => {
        if (current && next.games.some(game => game.roomCode === current)) return current;
        return next.games.find(game => game.status === 'live')?.roomCode ?? next.games[0]?.roomCode ?? '';
      });
    } catch {
      setRefreshFailed(true);
    }
  }, [tournamentId]);

  useEffect(() => {
    setSelectedRoom('');
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const selectedGame = useMemo(() => view.games.find(game => game.roomCode === selectedRoom) ?? null, [selectedRoom, view.games]);
  const hasConfirmedData = Boolean(view.updatedAt || view.games.length || view.standings.length);

  return (
    <div className="tournament-live-panel">
      <div className="detail-heading-v22 tournament-live-heading">
        <div><span className="qqurz-kicker">LIVE VIEWING</span><h2>{tournamentName}</h2></div>
        <span>{view.liveGames} live · {view.completedGames} finished</span>
      </div>

      {refreshFailed && <StateNotice
        className="compact"
        tone="warning"
        icon="↻"
        title={hasConfirmedData ? 'Live updates paused' : 'Live tournament view unavailable'}
        body={<p>{hasConfirmedData ? 'QQURZ is keeping the last server-confirmed boards and standings on screen while the live feed reconnects.' : 'The tournament viewing service did not answer. No live board data is being guessed.'}</p>}
        actions={[{ label: 'Retry live view', onClick: () => void refresh(), primary: !hasConfirmedData }]}
      />}

      {!view.games.length ? (
        <StateNotice
          className="compact"
          tone="neutral"
          icon="♟"
          eyebrow="LIVE BOARDS"
          title="No tournament boards are live yet"
          body={<p>When the tournament server starts or registers a game, its board will appear here automatically. Nothing needs to be refreshed manually.</p>}
          detail="Completed games remain available here after they finish, and server-confirmed results feed the standings."
          live="off"
        />
      ) : (
        <>
          <div className="tournament-game-picker" role="list" aria-label="Tournament games">
            {view.games.map(game => (
              <button
                key={game.roomCode}
                type="button"
                role="listitem"
                className={`${selectedRoom === game.roomCode ? 'selected' : ''} ${game.status}`}
                onClick={() => setSelectedRoom(game.roomCode)}
              >
                <span>{game.status === 'live' ? '● LIVE' : 'FINAL'} · R{game.round}</span>
                <b>{game.white.name} <i>vs</i> {game.black.name}</b>
                <small>{rating(game.white.rating)} · {rating(game.black.rating)}{game.result ? ` · ${game.result}` : ''}</small>
              </button>
            ))}
          </div>

          {selectedGame && (
            <div className="tournament-selected-game">
              <div className="selected-game-heading">
                <div><span>{selectedGame.status === 'live' ? 'WATCHING LIVE' : 'REPLAYING FINAL POSITION'}</span><b>{selectedGame.white.name} vs {selectedGame.black.name}</b></div>
                <small>Room {selectedGame.roomCode}</small>
              </div>
              <TournamentSpectatorBoard roomCode={selectedGame.roomCode} />
            </div>
          )}
        </>
      )}

      <section className="tournament-standings" aria-label="Tournament standings">
        <div className="tournament-standings-head"><div><span>STANDINGS</span><b>Live results table</b></div><small>Updates after server-confirmed results</small></div>
        {view.standings.length ? (
          <div className="tournament-standings-scroll">
            <table>
              <thead><tr><th>#</th><th>Player</th><th>Rating</th><th>G</th><th>W</th><th>D</th><th>L</th><th>Pts</th><th>Status</th></tr></thead>
              <tbody>
                {view.standings.map(entry => (
                  <tr key={`${entry.rank}-${entry.name}`}>
                    <td>{entry.rank}</td>
                    <td><b>{entry.name}</b></td>
                    <td>{rating(entry.rating)}</td>
                    <td>{entry.games}</td>
                    <td>{entry.wins}</td>
                    <td>{entry.draws}</td>
                    <td>{entry.losses}</td>
                    <td><b>{score(entry.score)}</b></td>
                    <td><span className={`standing-state ${entry.status}`}>{entry.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <StateNotice className="compact" tone="neutral" icon="≡" title="Standings haven’t started yet" body={<p>The table appears after the tournament server registers players and confirms game results. Zero rows here does not mean an error.</p>} live="off" />}
      </section>

      <div className="spectator-analysis-boundary">
        <b>Competitive boundary</b>
        <span>Spectator analysis is not part of this player room. A future analysis board can run separately so engines never enter active competitive interfaces.</span>
      </div>
    </div>
  );
}
