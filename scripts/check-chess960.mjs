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

  const files = 'abcdefgh';
  const parse = fen => Chess.fromSetup(parseFen(fen).unwrap()).unwrap();
  const boardFen = pos => rules.serializeChess960Fen(pos, 'xfen').split(' ')[0];
  const play = (pos, uci) => {
    const move = parseUci(uci);
    assert.ok(move, `Could not parse ${uci}`);
    assert.ok(pos.isLegal(move), `${uci} must be legal in ${rules.serializeChess960Fen(pos, 'shredder')}`);
    pos.play(move);
    return move;
  };
  const rankFen = entries => {
    const pieces = new Map(entries);
    let out = '';
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = pieces.get(file);
      if (!piece) { empty += 1; continue; }
      if (empty) { out += String(empty); empty = 0; }
      out += piece;
    }
    if (empty) out += String(empty);
    return out;
  };
  const pieceAt = (pos, square) => {
    const parsed = parseSquare(square);
    assert.notEqual(parsed, undefined, `Bad square ${square}`);
    return pos.board.get(parsed);
  };

  const seen = new Set();
  const castlingSources = new Set();
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
    castlingSources.add(`a:${king}:${rooks[0]}`);
    castlingSources.add(`h:${king}:${rooks[1]}`);

    const shredder = rules.parseChess960Fen(mapping.chess960Fen(id, 'shredder'));
    const xfen = rules.parseChess960Fen(mapping.chess960Fen(id, 'xfen'));
    assert.equal(rules.chessPositionKey(shredder), rules.chessPositionKey(xfen), `X-FEN/Shredder-FEN mismatch for #${id}`);
    assert.equal(rules.serializeChess960Fen(shredder, 'shredder').split(' ')[2], mapping.chess960InitialCastlingField(rank, 'shredder'));
  }
  assert.equal(seen.size, 960);
  assert.equal(mapping.chess960BackRank(518), 'RNBQKBNR');
  assert.equal(mapping.chess960Fen(518, 'shredder').split(' ')[2], 'HAha');
  assert.equal(mapping.chess960Fen(518, 'xfen').split(' ')[2], 'KQkq');

  // Exhaust every distinct king/rook source geometry that can occur in any of
  // the 960 starts. Test each side for both White and Black with all unrelated
  // pieces cleared, including swaps, stationary king/rook cases and crossings.
  let exhaustiveCastleChecks = 0;
  for (const source of castlingSources) {
    const [side, kingRaw, rookRaw] = source.split(':');
    const kingFile = Number(kingRaw);
    const rookFile = Number(rookRaw);
    for (const color of ['white', 'black']) {
      const rank = color === 'white' ? 1 : 8;
      const otherRank = color === 'white' ? 8 : 1;
      const ownKing = color === 'white' ? 'K' : 'k';
      const ownRook = color === 'white' ? 'R' : 'r';
      const otherKing = color === 'white' ? 'k' : 'K';
      const safeOtherKingFile = [...Array(8).keys()].find(file => file !== rookFile);
      assert.notEqual(safeOtherKingFile, undefined);

      const ownRankFen = rankFen([[kingFile, ownKing], [rookFile, ownRook]]);
      const otherRankFen = rankFen([[safeOtherKingFile, otherKing]]);
      const fen = color === 'white'
        ? `${otherRankFen}/8/8/8/8/8/8/${ownRankFen} w ${files[rookFile].toUpperCase()} - 0 1`
        : `${ownRankFen}/8/8/8/8/8/8/${otherRankFen} b ${files[rookFile]} - 0 1`;
      const pos = parse(fen);
      const kingFrom = `${files[kingFile]}${rank}`;
      const rookFrom = `${files[rookFile]}${rank}`;
      const uci = `${kingFrom}${rookFrom}`;
      const move = parseUci(uci);
      assert.ok(move, `${color} ${source}: UCI parse`);
      assert.ok(pos.isLegal(move), `${color} ${source}: castling must be legal in ${fen}`);
      assert.equal(makeSan(pos, move), side === 'h' ? 'O-O' : 'O-O-O', `${color} ${source}: SAN`);
      assert.ok(chessgroundDests(pos, { chess960: true }).get(kingFrom)?.includes(rookFrom), `${color} ${source}: Chessground destination`);
      pos.play(move);

      const kingTo = `${side === 'h' ? 'g' : 'c'}${rank}`;
      const rookTo = `${side === 'h' ? 'f' : 'd'}${rank}`;
      assert.deepEqual(pieceAt(pos, kingTo), { role: 'king', color }, `${color} ${source}: king final square`);
      assert.deepEqual(pieceAt(pos, rookTo), { role: 'rook', color }, `${color} ${source}: rook final square`);
      exhaustiveCastleChecks += 1;
    }
  }
  assert.ok(exhaustiveCastleChecks > 0, 'No Chess960 castling geometries were exercised.');

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

  // Castling is illegal while in check, through check, or into check.
  for (const [name, fen, uci] of [
    ['out of check', 'k3r3/8/8/8/8/8/8/4K2R w H - 0 1', 'e1h1'],
    ['through check', '2r4k/8/8/8/8/8/8/1K2R3 w E - 0 1', 'b1e1'],
    ['into check', 'k5r1/8/8/8/8/8/8/4K2R w H - 0 1', 'e1h1'],
  ]) {
    const pos = parse(fen);
    const move = parseUci(uci);
    assert.ok(move);
    assert.equal(pos.isLegal(move), false, `castling ${name} must be illegal`);
  }

  // The non-castling rook can itself block a Chess960 destination square.
  for (const [name, fen, uci] of [
    ['other rook occupies f1', '4k3/8/8/8/8/8/8/5RKR w HF - 0 1', 'g1h1'],
    ['other rook occupies c1', '4k3/8/8/8/8/8/8/RKR5 w CA - 0 1', 'b1a1'],
  ]) {
    const pos = parse(fen);
    const move = parseUci(uci);
    assert.ok(move);
    assert.equal(pos.isLegal(move), false, `${name} must block castling`);
  }

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

  // Fifty-move and seventy-five-move thresholds use the FEN halfmove clock.
  const fifty = parse('7k/8/8/8/8/8/4K3/R7 w - - 99 1');
  play(fifty, 'a1a2');
  assert.equal(fifty.halfmoves, 100);
  assert.equal(rules.adjudicateChess(fifty, [rules.chessPositionKey(fifty)])?.text, 'Draw by fifty-move rule');
  const seventyFive = parse('7k/8/8/8/8/8/4K3/R7 w - - 149 1');
  play(seventyFive, 'a1a2');
  assert.equal(seventyFive.halfmoves, 150);
  assert.equal(rules.adjudicateChess(seventyFive, [rules.chessPositionKey(seventyFive)])?.text, 'Draw by seventy-five-move rule');

  const pawnReset = parse('7k/8/8/8/8/8/P3K3/8 w - - 99 1');
  play(pawnReset, 'a2a3');
  assert.equal(pawnReset.halfmoves, 0, 'pawn move must reset halfmove clock');

  for (const [name, fen] of [
    ['king versus king', '7k/8/8/8/8/8/8/K7 w - - 0 1'],
    ['king and bishop versus king', '7k/8/8/8/8/8/2B5/K7 w - - 0 1'],
    ['king and knight versus king', '7k/8/8/8/8/8/2N5/K7 w - - 0 1'],
  ]) {
    const pos = parse(fen);
    assert.equal(pos.isInsufficientMaterial(), true, `${name} must be insufficient material`);
    assert.equal(rules.adjudicateChess(pos, [rules.chessPositionKey(pos)])?.text, 'Draw by insufficient material');
  }

  const mate = parse('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(mate.isCheckmate(), true);
  assert.equal(rules.adjudicateChess(mate, [rules.chessPositionKey(mate)])?.kind, 'CHECKMATE');

  const stalemate = parse('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stalemate.isStalemate(), true);
  assert.equal(rules.adjudicateChess(stalemate, [rules.chessPositionKey(stalemate)])?.text, 'Draw by stalemate');

  for (const square of ['a1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1', 'a8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8']) {
    assert.notEqual(parseSquare(square), undefined);
  }

  console.log(`Chess960 verification passed: 960 mappings, ${exhaustiveCastleChecks} exhaustive castling geometries, FEN round-trips, repetition and draw rules.`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
