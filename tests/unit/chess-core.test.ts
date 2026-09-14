import test from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chessops/chess';
import { chessgroundDests } from 'chessops/compat';
import { parseFen } from 'chessops/fen';
import {
  chess960BackRank,
  chess960Fen,
  chess960PositionId,
  isValidChess960BackRank,
} from '../../shared/chess960.ts';
import {
  adjudicateChess,
  chessPositionKey,
  parseChess960Fen,
  repetitionCount,
  serializeChess960Fen,
} from '../../shared/chess960Rules.ts';

test('all 960 Chess960 positions are unique, reversible, and legal back ranks', () => {
  const ranks = new Set<string>();
  for (let id = 0; id < 960; id += 1) {
    const rank = chess960BackRank(id);
    assert.equal(isValidChess960BackRank(rank), true, `position ${id} should be valid`);
    assert.equal(chess960PositionId(rank), id, `position ${id} should round-trip`);
    ranks.add(rank);

    const bishopFiles = [...rank].flatMap((piece, index) => piece === 'B' ? [index] : []);
    assert.equal(bishopFiles.length, 2);
    assert.notEqual(bishopFiles[0] % 2, bishopFiles[1] % 2, 'bishops must start on opposite colors');

    const king = rank.indexOf('K');
    const rooks = [...rank].flatMap((piece, index) => piece === 'R' ? [index] : []);
    assert.equal(rooks.length, 2);
    assert.ok(rooks[0] < king && king < rooks[1], 'king must start between the rooks');
  }
  assert.equal(ranks.size, 960);
  assert.equal(chess960BackRank(518), 'RNBQKBNR');
});

test('Chess960 initial position exposes the expected twenty legal opening moves', () => {
  const position = Chess.fromSetup(parseFen(chess960Fen(518)).unwrap()).unwrap();
  const dests = chessgroundDests(position, { chess960: true }) as Map<string, string[]>;
  const legalMoveCount = [...dests.values()].reduce((sum, squares) => sum + squares.length, 0);
  assert.equal(legalMoveCount, 20);
});

test('checkmate and stalemate are adjudicated correctly', () => {
  const mate = parseChess960Fen('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(adjudicateChess(mate, [chessPositionKey(mate)]), {
    kind: 'CHECKMATE',
    text: 'White wins by checkmate',
    winner: 'white',
  });

  const stalemate = parseChess960Fen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.deepEqual(adjudicateChess(stalemate, [chessPositionKey(stalemate)]), {
    kind: 'DRAW',
    text: 'Draw by stalemate',
    winner: null,
  });
});

test('threefold repetition and fifty-move rule are detected', () => {
  const initial = parseChess960Fen(chess960Fen(518));
  const key = chessPositionKey(initial);
  const repeated = [key, key, key];
  assert.equal(repetitionCount(repeated, initial), 3);
  assert.deepEqual(adjudicateChess(initial, repeated), {
    kind: 'DRAW',
    text: 'Draw by threefold repetition',
    winner: null,
  });

  const fiftyMove = parseChess960Fen('8/8/8/8/8/R7/7k/K7 w - - 100 51');
  assert.deepEqual(adjudicateChess(fiftyMove, [chessPositionKey(fiftyMove)]), {
    kind: 'DRAW',
    text: 'Draw by fifty-move rule',
    winner: null,
  });
});

test('Chess960 FEN serialization round-trips X-FEN and Shredder-FEN positions', () => {
  for (const id of [0, 137, 518, 959]) {
    const position = parseChess960Fen(chess960Fen(id, 'shredder'));
    const shredder = serializeChess960Fen(position, 'shredder');
    const reparsed = parseChess960Fen(shredder);
    assert.equal(chessPositionKey(reparsed), chessPositionKey(position));

    const xfen = serializeChess960Fen(position, 'xfen');
    assert.equal(chessPositionKey(parseChess960Fen(xfen)), chessPositionKey(position));
  }
});
