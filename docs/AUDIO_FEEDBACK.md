# QQURZ audio and haptic policy

QQURZ treats audio as part of the physical-chess presentation rather than as arcade feedback.

## Audio

- Move, capture, check, castle, game-start, game-end, physical-clock and quarter cues are recorded / organic samples.
- No oscillator, procedural noise, synthetic fanfare or arcade-style success/error tone is used for chess play.
- Castling is two restrained board-contact recordings in sequence, representing king and rook placement.
- SAN maps each move to exactly one primary cue in this order: castle, check, capture, ordinary move. This prevents stacked effects on checking captures or castling checks.
- The physical clock sound is played when the authoritative clock transfer is observed, not merely when a button is visually pressed.
- Production audio is staged into `public/sounds/chess` during the build. Live games therefore do not fetch audio from a third-party host.

## Haptics

- Haptics use `navigator.vibrate()` only after feature detection.
- Haptics are short and event-specific. They are opt-in per playback call so remote/background events do not automatically vibrate the device.
- A physical-clock press gets tactile feedback immediately on the device that pressed it; the recorded click still waits for the authoritative transfer.
- Browsers without vibration support show haptics as unavailable rather than emulating them.

## User control

`Sound & haptics` is the master mute. When muted, both audio and vibration stop immediately. The separate Game sounds and Haptics settings remain remembered underneath the master toggle so users can restore their previous mix later.

Source provenance for recorded assets lives in `public/sounds/chess/SOURCES.md`.
