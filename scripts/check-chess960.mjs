import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const tempRoot = resolve(root, '.tmp-chess960-check');

async function transpile(relativePath) {
  const sourcePath = resolve(root, relativePath);
  const targetPath = resolve(tempRoot, relativePath.replace(/\.ts$/, '.js'));
  const source = await readFile(sourcePath, 'utf8');
  let output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
    fileName: sourcePath,
  }).outputText;
  output = output.replace("from './chess960';", "from './chess960.js';");
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(targetPath, output);
  return targetPath;
}

await rm(tempRoot, { recursive: true, force: true });
const mappingPath = await transpile('shared/chess960.ts');
const rulesPath = await transpile('shared/chess960Rules.ts');

try {
  const mapping = await import(`file://${mappingPath}?v=${Date.now()}`);
  const rules = await import(`file://${rulesPath}?v=${Date.now()}`);
  const { Chess } = await import('chessops/chess');
  const { parseFen } = await import('chessops/fen');
  const { makeSan } = await import('chessops/san');
  const { parseSquare, parseUci } = await import('chessops/util');
  const { chessgroundDests } = await import('chessops/compat');

  const parse = fen => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const boardFen = pos => rules.serializeChess960Fen(pos, 'xfen').split(' ')[0];
  const play = (pos, uci) => {
    const move = parseUci(uci);
    assert.ok(move, `Could not parse ${uci}`);
    assert.ok(pos.isLegal(move), `${uci} must be legal in ${rules.serializeChess960Fen(pos, 'shredder')}`);
    pos.play(move);
    return move;
  };

  const seen = new Set();
  for (let id = 0; id < 960; id += 1) {
    const rank = mapping.chess960BackRank(id);
    assert.equal(rank.length, 8);
    assert.ok(mapping.isValidChess960BackRank(rank), `invalid rank for #${id}: ${rank}`);
    assert.equal(mapping.chess960PositionId(rank), id, `inverse mapping failed for #${id}`);
    assert.ok(!seen.has(rank), `duplicate back rank ${rank}`);
    seen.add(rank);

    const bishops = [...rank].map((piece, file) => piece === 'B' ? file : -1).filter(file => file >= 0);
    assert.notEqual(bishops[0] & 1, bishops[1] & 1, `bishops share square color in #${id}`);
    const king = rank.indexOf('K');
    const rooks = [...rank].map((piece, file) => piece === 'R' ? file : -1).filter(file => file >= 0);
    assert.ok(rooks[0] < king && king < rooks[1], `king is not between rooks in #${id}`);

    const shredder = rules.parseChess960Fen(mapping.chess960Fen(id, 'shredder'));
    const xfen = rules.parseChess960Fen(mapping.chess960Fen(id, 'xfen'));
    assert.equal(rules.chessPositionKey(shredder), rules.chessPositionKey(xfen), `X-FEN/Shredder-FEN mismatch for #${id}`);
    assert.equal(rules.serializeChess960Fen(shredder, 'shredder').split(' ')[2], mapping.chess960InitialCastlingField(rank, 'shredder'));
  }
  assert.equal(seen.size, 960);
  assert.equal(mapping.chess960BackRank(518), 'RNBQKBNR');
  assert.equal(mapping.chess960Fen(518, 'shredder').split(' ')[2], 'HAha');
  assert.equal(mapping.chess960Fen(518, 'xfen').split(' ')[2], 'KQkq');

  const castleCases = [
    { name: 'king already on g1', fen: '4k3/8/8/8/8/8/8/6KR w H - 0 1', uci: 'g1h1', san: 'O-O', board: '4k3/8/8/8/8/8/8/5RK1' },
    { name: 'king already on c1', fen: '4k3/8/8/8/8/8/8/R1K5 w A - 0 1', uci: 'c1a1', san: 'O-O-O', board: '4k3/8/8/8/8/8/8/2KR4' },
    { name: 'kingside rook already on f1', fen: '4k3/8/8/8/8/8/8/4KR2 w F - 0 1', uci: 'e1f1', san: 'O-O', board: '4k3/8/8/8/8/8/8/5RK1' },
    { name: 'queenside rook already on d1', fen: '4k3/8/8/8/8/8/8/3RK3 w D - 0 1', uci: 'e1d1', san: 'O-O-O', board: '4k3/8/8/8/8/8/8/2KR4' },
    { name: 'rook between king and g-file destination', fen: '7k/8/8/8/8/8/8/1K2R3 w E - 0 1', uci: 'b1e1', san: 'O-O', board: '7k/8/8/8/8/8/8/5RK1' },
    { name: 'rook between king and c-file destination', fen: '7k/8/8/8/8/8/8/3R2K1 w D - 0 1', uci: 'g1d1', san: 'O-O-O', board: '7k/8/8/8/8/8/8/2KR4' },
  ];

  for (const test of castleCases) {
    const pos = parse(test.fen);
    const move = parseUci(test.uci);
    assert.ok(move, `${test.name}: UCI parse`);
    assert.ok(pos.isLegal(move), `${test.name}: castling must be legal`);
    assert.equal(makeSan(pos, move), test.san, `${test.name}: SAN`);
    const from = test.uci.slice(0, 2);
    const dest = test.uci.slice(2, 4);
    assert.ok(chessgroundDests(pos, { chess960: true }).get(from)?.includes(dest), `${test.name}: Chessground must use king-to-rook destination`);
    pos.play(move);
    assert.equal(boardFen(pos), test.board, `${test.name}: final king/rook squares`);
  }

  // A king may not castle out of, through, or into check.
  const attackedPath = parse('2r4k/8/8/8/8/8/8/1K2R3 w E - 0 1');
  const attackedMove = parseUci('b1e1');
  assert.ok(attackedMove);
  assert.equal(attackedPath.isLegal(attackedMove), false, 'castling through attacked c1 must be illegal');

  // Castling rights are part of repetition identity.
  const withRights = parse('4k3/8/8/8/8/8/8/R3K2R w HA - 0 1');
  const withoutRights = parse('4k3/8/8/8/8/8/8/R3K2R w - - 0 1');
  assert.notEqual(rules.chessPositionKey(withRights), rules.chessPositionKey(withoutRights));

  // A phantom en-passant square is ignored for repetition; a legal one is not.
  const phantomEp = parse('7k/8/8/4p3/8/8/8/K7 w - e6 0 1');
  const noEp = parse('7k/8/8/4p3/8/8/8/K7 w - - 0 1');
  assert.equal(rules.chessPositionKey(phantomEp), rules.chessPositionKey(noEp));
  const legalEp = parse('7k/8/8/3Pp3/8/8/8/K7 w - e6 0 1');
  const legalEpMissing = parse('7k/8/8/3Pp3/8/8/8/K7 w - - 0 1');
  assert.notEqual(rules.chessPositionKey(legalEp), rules.chessPositionKey(legalEpMissing));

  // Threefold repetition from an actual reversible move cycle.
  const repetition = rules.parseChess960Fen(mapping.chess960Fen(518, 'shredder'));
  let history = [rules.chessPositionKey(repetition)];
  for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8']) {
    play(repetition, uci);
    history = rules.appendPositionHistory(history, repetition);
  }
  assert.equal(rules.repetitionCount(history, repetition), 3);
  assert.equal(rules.adjudicateChess(repetition, history)?.text, 'Draw by threefold repetition');

  // Fifty-move counter is preserved by chessops and adjudicated at 100 halfmoves.
  const fifty = parse('7k/8/8/8/8/8/4K3/R7 w - - 99 1');
  play(fifty, 'a1a2');
  assert.equal(fifty.halfmoves, 100);
  assert.equal(rules.adjudicateChess(fifty, [rules.chessPositionKey(fifty)])?.text, 'Draw by fifty-move rule');

  const insufficient = parse('7k/8/8/8/8/8/8/K7 w - - 0 1');
  assert.equal(rules.adjudicateChess(insufficient, [rules.chessPositionKey(insufficient)])?.text, 'Draw by insufficient material');

  const mate = parse('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(mate.isCheckmate(), true);
  assert.equal(rules.adjudicateChess(mate, [rules.chessPositionKey(mate)])?.kind, 'CHECKMATE');

  const stalemate = parse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stalemate.isStalemate(), true);
  assert.equal(rules.adjudicateChess(stalemate, [rules.chessPositionKey(stalemate)])?.text, 'Draw by stalemate');

  // Explicit square parsing sanity for every back-rank file used by castling tests.
  for (const square of ['a1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1']) assert.notEqual(parseSquare(square), undefined);

  console.log('Chess960 verification passed: 960 mappings, FEN round-trips, castling edge cases, repetition and draw rules.');
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
