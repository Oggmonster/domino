export type PlayerId = "human" | "cpu";
export type BoardSide = "left" | "right";

export type DominoTile = {
  id: string;
  a: number;
  b: number;
};

export type PlacedDomino = {
  tile: DominoTile;
  left: number;
  right: number;
  isDouble: boolean;
};

export type DominoMove = {
  tile: DominoTile;
  side: BoardSide;
  placement: PlacedDomino;
};

export type RoundOutcome = {
  winner: PlayerId | "draw";
  reason: string;
  humanPips: number;
  cpuPips: number;
  pointsAwarded: number;
};

export type CpuContext = {
  humanBlockedEnds: number[];
  stockCount: number;
  opponentHandCount: number;
};

export const HAND_SIZE = 7;
export const MAX_PIP = 6;
export const MATCH_TARGET = 60;

export function createDominoSet() {
  const tiles: DominoTile[] = [];

  for (let a = 0; a <= MAX_PIP; a += 1) {
    for (let b = a; b <= MAX_PIP; b += 1) {
      tiles.push({ id: `${a}-${b}`, a, b });
    }
  }

  return tiles;
}

export function shuffleDominoes(tiles: DominoTile[]) {
  const copy = [...tiles];

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const current = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = current;
  }

  return copy;
}

export function describeTile(tile: DominoTile) {
  return `${tile.a}|${tile.b}`;
}

export function tileTotal(tile: DominoTile) {
  return tile.a + tile.b;
}

export function isDouble(tile: DominoTile) {
  return tile.a === tile.b;
}

export function handPipTotal(hand: DominoTile[]) {
  return hand.reduce((total, tile) => total + tileTotal(tile), 0);
}

export function dealRound() {
  const stack = shuffleDominoes(createDominoSet());

  return {
    humanHand: stack.slice(0, HAND_SIZE),
    cpuHand: stack.slice(HAND_SIZE, HAND_SIZE * 2),
    stock: stack.slice(HAND_SIZE * 2),
  };
}

export function chooseOpeningTile(humanHand: DominoTile[], cpuHand: DominoTile[]) {
  const ranked = [
    ...humanHand.map((tile) => ({ tile, player: "human" as const })),
    ...cpuHand.map((tile) => ({ tile, player: "cpu" as const })),
  ].sort((left, right) => compareOpeningTiles(right.tile, left.tile));

  return ranked[0];
}

function compareOpeningTiles(left: DominoTile, right: DominoTile) {
  const leftDouble = Number(isDouble(left));
  const rightDouble = Number(isDouble(right));

  if (leftDouble !== rightDouble) {
    return leftDouble - rightDouble;
  }

  const totalDiff = tileTotal(left) - tileTotal(right);

  if (totalDiff !== 0) {
    return totalDiff;
  }

  return Math.max(left.a, left.b) - Math.max(right.a, right.b);
}

export function getBoardEnds(board: PlacedDomino[]) {
  if (!board.length) {
    return null;
  }

  return {
    left: board[0].left,
    right: board[board.length - 1].right,
  };
}

export function tileMatchesValue(tile: DominoTile, value: number) {
  return tile.a === value || tile.b === value;
}

export function createPlacement(
  board: PlacedDomino[],
  tile: DominoTile,
  side: BoardSide,
) {
  if (!board.length) {
    return {
      tile,
      left: tile.a,
      right: tile.b,
      isDouble: isDouble(tile),
    };
  }

  const ends = getBoardEnds(board);

  if (!ends) {
    throw new Error("Cannot place tile on an invalid board.");
  }

  if (side === "left") {
    if (!tileMatchesValue(tile, ends.left)) {
      throw new Error(`Tile ${describeTile(tile)} cannot be placed on the left.`);
    }

    if (tile.a === ends.left && tile.b === ends.left) {
      return { tile, left: tile.a, right: tile.b, isDouble: true };
    }

    if (tile.a === ends.left) {
      return { tile, left: tile.b, right: tile.a, isDouble: false };
    }

    return { tile, left: tile.a, right: tile.b, isDouble: false };
  }

  if (!tileMatchesValue(tile, ends.right)) {
    throw new Error(`Tile ${describeTile(tile)} cannot be placed on the right.`);
  }

  if (tile.a === ends.right && tile.b === ends.right) {
    return { tile, left: tile.a, right: tile.b, isDouble: true };
  }

  if (tile.a === ends.right) {
    return { tile, left: tile.a, right: tile.b, isDouble: false };
  }

  return { tile, left: tile.b, right: tile.a, isDouble: false };
}

export function applyMove(board: PlacedDomino[], move: DominoMove) {
  if (!board.length) {
    return [move.placement];
  }

  return move.side === "left"
    ? [move.placement, ...board]
    : [...board, move.placement];
}

export function getLegalMoves(hand: DominoTile[], board: PlacedDomino[]) {
  if (!board.length) {
    return hand.map((tile) => ({
      tile,
      side: "right" as const,
      placement: createPlacement(board, tile, "right"),
    }));
  }

  const ends = getBoardEnds(board);

  if (!ends) {
    return [];
  }

  const moves: DominoMove[] = [];

  for (const tile of hand) {
    if (tileMatchesValue(tile, ends.left)) {
      moves.push({
        tile,
        side: "left",
        placement: createPlacement(board, tile, "left"),
      });
    }

    if (tileMatchesValue(tile, ends.right)) {
      moves.push({
        tile,
        side: "right",
        placement: createPlacement(board, tile, "right"),
      });
    }
  }

  return moves;
}

export function removeTileFromHand(hand: DominoTile[], tileId: string) {
  return hand.filter((tile) => tile.id !== tileId);
}

export function resolveBlockedRound(
  humanHand: DominoTile[],
  cpuHand: DominoTile[],
): RoundOutcome {
  const humanPips = handPipTotal(humanHand);
  const cpuPips = handPipTotal(cpuHand);

  if (humanPips === cpuPips) {
    return {
      winner: "draw",
      reason: "Both players were blocked with the same pip total.",
      humanPips,
      cpuPips,
      pointsAwarded: 0,
    };
  }

  const winner = humanPips < cpuPips ? "human" : "cpu";
  const pointsAwarded = Math.abs(humanPips - cpuPips);

  return {
    winner,
    reason:
      winner === "human"
        ? "Both players were blocked. You won on the lower pip total."
        : "Both players were blocked. CPU won on the lower pip total.",
    humanPips,
    cpuPips,
    pointsAwarded,
  };
}

export function resolvePlayedOutRound(
  winner: PlayerId,
  humanHand: DominoTile[],
  cpuHand: DominoTile[],
): RoundOutcome {
  const humanPips = handPipTotal(humanHand);
  const cpuPips = handPipTotal(cpuHand);
  const pointsAwarded = winner === "human" ? cpuPips : humanPips;

  return {
    winner,
    reason:
      winner === "human"
        ? "You played your last domino."
        : "CPU played its last domino.",
    humanPips,
    cpuPips,
    pointsAwarded,
  };
}

export function chooseCpuMove(
  hand: DominoTile[],
  board: PlacedDomino[],
  context: CpuContext,
) {
  const legalMoves = getLegalMoves(hand, board);

  if (!legalMoves.length) {
    return null;
  }

  const allTiles = createDominoSet();
  const publicTiles = new Set([
    ...board.map((placed) => placed.tile.id),
    ...hand.map((tile) => tile.id),
  ]);

  const unseenTiles = allTiles.filter((tile) => !publicTiles.has(tile.id));
  const lateRoundWeight = context.stockCount === 0 || context.opponentHandCount <= 3 ? 1.4 : 1;

  return legalMoves
    .map((move) => {
      const nextBoard = applyMove(board, move);
      const nextEnds = getBoardEnds(nextBoard);
      const remainingHand = removeTileFromHand(hand, move.tile.id);
      const unloadScore = tileTotal(move.tile) * 1.35;
      const doubleScore = isDouble(move.tile) ? (remainingHand.length <= 3 ? 2.5 : 0.9) : 0;
      const futureSupport = nextEnds
        ? remainingHand.filter(
            (tile) =>
              tileMatchesValue(tile, nextEnds.left) || tileMatchesValue(tile, nextEnds.right),
          ).length
        : 0;
      const balancedEndsScore = nextEnds
        ? Math.min(
            remainingHand.filter((tile) => tileMatchesValue(tile, nextEnds.left)).length,
            remainingHand.filter((tile) => tileMatchesValue(tile, nextEnds.right)).length,
          ) * 1.8
        : 0;
      const blockedBonus = nextEnds
        ? context.humanBlockedEnds.reduce((bonus, value) => {
            if (nextEnds.left === value || nextEnds.right === value) {
              return bonus + 4 * lateRoundWeight;
            }

            return bonus;
          }, 0)
        : 0;
      const scarcityBonus = nextEnds
        ? (7 - unseenMatchCount(unseenTiles, nextEnds.left) + (7 - unseenMatchCount(unseenTiles, nextEnds.right))) *
          0.85 *
          lateRoundWeight
        : 0;
      const flexibilityPenalty = remainingHand.length
        ? remainingHand.filter(
            (tile) =>
              nextEnds &&
              !tileMatchesValue(tile, nextEnds.left) &&
              !tileMatchesValue(tile, nextEnds.right),
          ).length * 0.4
        : 0;
      const winningBonus = remainingHand.length === 0 ? 10_000 : 0;

      return {
        move,
        score:
          winningBonus +
          unloadScore +
          doubleScore +
          futureSupport * 2.25 +
          balancedEndsScore +
          blockedBonus +
          scarcityBonus -
          flexibilityPenalty,
      };
    })
    .sort((left, right) => right.score - left.score)[0].move;
}

function unseenMatchCount(unseenTiles: DominoTile[], value: number) {
  return unseenTiles.filter((tile) => tileMatchesValue(tile, value)).length;
}
