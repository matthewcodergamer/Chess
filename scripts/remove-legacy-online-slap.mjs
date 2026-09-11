import fs from 'node:fs';

const path = 'src/multiplayer/OnlineArena.tsx';
let source = fs.readFileSync(path, 'utf8');
const before = source;
source = source.replace("  const lastAwaitingPress = useRef<'white' | 'black' | null>(null);\n", '');
source = source.replace("    if (lastAwaitingPress.current && !snapshot.awaitingClockPress) playChessSound('slap');\n    lastAwaitingPress.current = snapshot.awaitingClockPress;\n", '');
if (source === before) throw new Error('Legacy online slap observer was not found.');
fs.writeFileSync(path, source);
console.log('Removed duplicate online slap sound observer; PhysicalChessClock is now the sole slap-feedback owner.');
