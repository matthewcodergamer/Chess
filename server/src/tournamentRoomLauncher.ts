import { pairingPosition, type EnginePairing, type EngineRound, type EngineTournament, type Participant, type Seat } from './tournamentEngineTypes';

type RoomStub = { fetch(request: Request): Promise<Response> };
type RoomNamespace = { idFromName(name: string): DurableObjectId; get(id: DurableObjectId): RoomStub };
type LaunchEnv = { ROOMS: unknown };
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return [...bytes].map(value => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('');
}

export async function launchTournamentRoom(
  env: LaunchEnv,
  tournament: EngineTournament,
  round: EngineRound,
  pairing: EnginePairing,
): Promise<{ white: Participant; black: Participant }> {
  if (!pairing.blackId) throw new Error('A bye does not need a game room.');
  const white = tournament.participants[pairing.whiteId];
  const black = tournament.participants[pairing.blackId];
  if (!white || !black) throw new Error('Pairing references a missing participant.');
  const rooms = env.ROOMS as RoomNamespace;

  let lastError = 'Could not allocate game room.';
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = roomCode();
    const stub = rooms.get(rooms.idFromName(code));
    const positionId = pairingPosition(tournament, round);
    const create = await stub.fetch(new Request('https://room.internal/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code,
        name: white.name,
        accountId: white.accountId,
        timeControl: tournament.timeControl,
        positionId,
        tournamentDirectStart: true,
      }),
    }));
    if (create.status === 409) continue;
    if (!create.ok) {
      const payload = await create.json().catch(() => ({})) as { error?: string };
      lastError = payload.error ?? lastError;
      continue;
    }
    const whiteSeat = await create.json() as Seat;
    const join = await stub.fetch(new Request('https://room.internal/join', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: black.name, accountId: black.accountId, tournamentDirectStart: true }),
    }));
    if (!join.ok) {
      const payload = await join.json().catch(() => ({})) as { error?: string };
      lastError = payload.error ?? lastError;
      continue;
    }
    const blackSeat = await join.json() as Seat;
    const link = await stub.fetch(new Request('https://room.internal/engine-tournament-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tournamentId: tournament.id,
        ratingsByToken: {
          [whiteSeat.token]: white.rating,
          [blackSeat.token]: black.rating,
        },
      }),
    }));
    if (!link.ok) {
      lastError = 'Could not bind the room to its tournament.';
      continue;
    }

    pairing.roomCode = code;
    pairing.whiteSeatToken = whiteSeat.token;
    pairing.blackSeatToken = blackSeat.token;
    pairing.positionId = positionId;
    pairing.status = 'live';
    pairing.launchedAt = Date.now();
    pairing.launchError = null;
    return { white, black };
  }

  pairing.status = 'launch_error';
  pairing.launchError = lastError;
  throw new Error(lastError);
}
