export type FriendlyIssue = {
  title: string;
  body: string;
};

function textOf(value: unknown): string {
  return value instanceof Error ? value.message.toLowerCase() : String(value ?? '').toLowerCase();
}

export function tournamentIssue(value: unknown, action = 'update your tournament entry'): FriendlyIssue {
  const text = textOf(value);
  if (text.includes('invite')) return {
    title: 'That invite code was not accepted',
    body: 'Check the code with the organizer and try again. Your tournament entry was not changed.',
  };
  if (text.includes('full') || text.includes('capacity') || text.includes('seat')) return {
    title: 'Those seats filled up',
    body: 'The tournament reached capacity before this action completed. No new entry was added.',
  };
  if (text.includes('payment') || text.includes('wallet') || text.includes('fund')) return {
    title: 'Registration was not completed',
    body: 'QQURZ could not confirm the payment or wallet step. No tournament entry was completed; review your wallet and try again.',
  };
  if (text.includes('network') || text.includes('fetch') || text.includes('server') || text.includes('unavailable')) return {
    title: 'Tournament server unavailable',
    body: 'QQURZ could not reach live tournament records. Your existing registration and results were not changed.',
  };
  return {
    title: 'Tournament action did not finish',
    body: `QQURZ could not ${action}. Nothing was changed; try again.`,
  };
}

export function roomIssue(value: unknown, context: 'join' | 'create' | 'live' = 'live'): FriendlyIssue & { invalidInvite?: boolean } {
  const text = textOf(value);
  if (context === 'join' && (text.includes('does not exist') || text.includes('not found') || text.includes('invalid room') || text.includes('seat token') || text.includes('room code'))) {
    return {
      title: 'That invite is no longer valid',
      body: 'The room may have expired or the code may be mistyped. No game was joined.',
      invalidInvite: true,
    };
  }
  if (text.includes('network') || text.includes('fetch') || text.includes('server') || text.includes('websocket') || text.includes('unavailable')) return {
    title: 'QQURZ cannot reach the room server',
    body: 'Your local settings are safe. Retry when the connection returns; server-authoritative game state is not replaced by the browser.',
  };
  if (context === 'create') return {
    title: 'Room was not created',
    body: 'QQURZ could not open a new server room. No invite was created; retry when the connection is stable.',
  };
  if (context === 'join') return {
    title: 'Could not join this room',
    body: 'The room may be full, expired, or temporarily unavailable. You can try the code again or create a new room.',
  };
  return {
    title: 'Room update was not accepted',
    body: 'QQURZ kept the last server-confirmed position. Retry the connection instead of relying on a local guess.',
  };
}

export function checkoutIssue(value: unknown): FriendlyIssue {
  const text = textOf(value);
  if (text.includes('network') || text.includes('fetch') || text.includes('server') || text.includes('unavailable')) return {
    title: 'Checkout is temporarily unavailable',
    body: 'No QQURZ purchase was completed. You can keep playing and try checkout again later.',
  };
  return {
    title: 'Checkout did not open',
    body: 'No QQURZ purchase was completed. Review your connection and try again if you still want this item.',
  };
}

export function accountIssue(value: unknown): FriendlyIssue {
  const text = textOf(value);
  if (text.includes('password') || text.includes('credential') || text.includes('login')) return {
    title: 'Sign-in details were not accepted',
    body: 'Check your email or username and password, then try again.',
  };
  if (text.includes('verify') || text.includes('verification') || text.includes('expired token')) return {
    title: 'That verification link cannot be used',
    body: 'It may be invalid or expired. Request a fresh verification email and try again.',
  };
  if (text.includes('already') || text.includes('taken') || text.includes('exists')) return {
    title: 'That account detail is already in use',
    body: 'Try another username or email address.',
  };
  if (text.includes('network') || text.includes('fetch') || text.includes('server') || text.includes('unavailable')) return {
    title: 'Account server unavailable',
    body: 'QQURZ could not complete that account action. Your existing account data was not changed; try again.',
  };
  return {
    title: 'Account action did not finish',
    body: 'QQURZ could not complete that request. Nothing was changed; try again.',
  };
}
