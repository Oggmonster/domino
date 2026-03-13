import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

import { HiddenDomino, VisibleDomino } from "../components/domino-tile";
import {
  MATCH_TARGET,
  applyMove,
  chooseCpuMove,
  chooseOpeningTile,
  createPlacement,
  dealRound,
  describeTile,
  getBoardEnds,
  getLegalMoves,
  handPipTotal,
  removeTileFromHand,
  resolveBlockedRound,
  resolvePlayedOutRound,
  type BoardSide,
  type DominoMove,
  type DominoTile,
  type PlacedDomino,
  type PlayerId,
  type RoundOutcome,
} from "../lib/dominoes";

import type { Route } from "./+types/home";

type Scoreboard = {
  human: number;
  cpu: number;
};

type GameState = {
  phase: "playing" | "intermission";
  currentPlayer: PlayerId;
  board: PlacedDomino[];
  boardStartIndex: number;
  requiredOpeningTileId: string | null;
  humanHand: DominoTile[];
  cpuHand: DominoTile[];
  stock: DominoTile[];
  humanBlockedEnds: number[];
  consecutivePasses: number;
  status: string;
  log: string[];
  roundOutcome: RoundOutcome | null;
  matchScore: Scoreboard;
  matchWinner: PlayerId | null;
};

type DragState = {
  tileId: string;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  overSide: BoardSide | null;
};

type PathCell = {
  x: number;
  y: number;
};

type BoardLayoutTile = {
  tile: PlacedDomino;
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
  flipped: boolean;
};

type DropSlot = {
  x: number;
  y: number;
  orientation: "horizontal" | "vertical";
  side: BoardSide;
};

type PathDirection = "left" | "right" | "up" | "down";

const SCORE_STORAGE_KEY = "domino-score-v1";
const BOARD_COLS = 9;
const BOARD_ROWS = 7;
const BOARD_PATH = createSnakePath(BOARD_COLS, BOARD_ROWS);
const BOARD_ANCHOR = Math.floor(BOARD_PATH.length / 2);
const INTERMISSION_SECONDS = 5;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Domino Duel" },
    {
      name: "description",
      content: "A tactile single-player domino match with a fair CPU opponent.",
    },
  ];
}

export default function Home() {
  const [wins, setWins] = useState<Scoreboard>({ human: 0, cpu: 0 });
  const [winsReady, setWinsReady] = useState(false);
  const [game, setGame] = useState<GameState>(() => createRound({ human: 0, cpu: 0 }));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [intermissionCountdown, setIntermissionCountdown] = useState(INTERMISSION_SECONDS);

  const leftDropRef = useRef<HTMLDivElement | null>(null);
  const rightDropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(SCORE_STORAGE_KEY);

      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Scoreboard>;

        setWins({
          human: typeof parsed.human === "number" ? parsed.human : 0,
          cpu: typeof parsed.cpu === "number" ? parsed.cpu : 0,
        });
      }
    } catch {
      setWins({ human: 0, cpu: 0 });
    } finally {
      setWinsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!winsReady) {
      return;
    }

    window.localStorage.setItem(SCORE_STORAGE_KEY, JSON.stringify(wins));
  }, [wins, winsReady]);

  useEffect(() => {
    if (game.phase !== "playing" || game.currentPlayer !== "cpu") {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const { nextGame, matchWinner } = runCpuTurn(game);

      if (matchWinner) {
        recordMatchWin(matchWinner);
      }

      setGame(nextGame);
    }, 900);

    return () => window.clearTimeout(timeoutId);
  }, [game]);

  useEffect(() => {
    if (game.phase !== "intermission") {
      setIntermissionCountdown(INTERMISSION_SECONDS);
      return;
    }

    setIntermissionCountdown(INTERMISSION_SECONDS);

    const startedAt = Date.now();
    const intervalId = window.setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      setIntermissionCountdown(Math.max(INTERMISSION_SECONDS - elapsedSeconds, 0));
    }, 200);

    const timeoutId = window.setTimeout(() => {
      startNextRound();
    }, INTERMISSION_SECONDS * 1000);

    return () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };
  }, [game.phase]);

  const boardEnds = getBoardEnds(game.board);
  const humanHandForTurn =
    game.requiredOpeningTileId && !game.board.length
      ? game.humanHand.filter((tile) => tile.id === game.requiredOpeningTileId)
      : game.humanHand;
  const humanMoves =
    game.phase === "playing" && game.currentPlayer === "human"
      ? getLegalMoves(humanHandForTurn, game.board)
      : [];
  const canPass =
    game.phase === "playing" && game.currentPlayer === "human" && humanMoves.length === 0;
  const boardLayout = layoutBoard(game.board, game.boardStartIndex);
  const dropSlots = getDropSlots(game.board, game.boardStartIndex);
  const draggedTile = drag ? game.humanHand.find((tile) => tile.id === drag.tileId) ?? null : null;
  const draggedMoves =
    draggedTile && game.phase === "playing" && game.currentPlayer === "human"
      ? getLegalMoves([draggedTile], game.board)
      : [];
  const canDropLeft = draggedMoves.some((move) => move.side === "left");
  const canDropRight = draggedMoves.some((move) => move.side === "right");
  const playableTileIds = new Set(humanMoves.map((move) => move.tile.id));

  function recordMatchWin(player: PlayerId) {
    setWins((current) => ({
      ...current,
      [player]: current[player] + 1,
    }));
  }

  function startNextRound() {
    setDrag(null);
    setGame((current) =>
      createRound(current.matchWinner ? { human: 0, cpu: 0 } : current.matchScore),
    );
  }

  function resetCurrentMatch() {
    setDrag(null);
    setIntermissionCountdown(INTERMISSION_SECONDS);
    setGame(createRound({ human: 0, cpu: 0 }));
  }

  function resetWins() {
    setWins({ human: 0, cpu: 0 });
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, tile: DominoTile) {
    if (game.phase !== "playing" || game.currentPlayer !== "human") {
      return;
    }

    if (!playableTileIds.has(tile.id)) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();

    setDrag({
      tileId: tile.id,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      overSide: null,
    });
  }

  useEffect(() => {
    if (!drag) {
      return;
    }

    const activeDrag = drag;

    function handleMove(event: PointerEvent) {
      setDrag((current) =>
        current
          ? {
              ...current,
              x: event.clientX,
              y: event.clientY,
              overSide: detectDropSide(event.clientX, event.clientY, leftDropRef, rightDropRef),
            }
          : null,
      );
    }

    function handleUp(event: PointerEvent) {
      const dropSide = detectDropSide(event.clientX, event.clientY, leftDropRef, rightDropRef);
      const move = dropSide
        ? findMoveForTileAndSide(humanMoves, activeDrag.tileId, dropSide)
        : null;
      const tile = game.humanHand.find((entry) => entry.id === activeDrag.tileId) ?? null;

      setDrag(null);

      if (move) {
        playHumanMove(move);
        return;
      }

      if (tile && dropSide) {
        setGame({
          ...game,
          status: `${describeTile(tile)} does not fit on the ${dropSide} end.`,
        });
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [drag, game, humanMoves]);

  useEffect(() => {
    if (game.phase !== "playing" || game.currentPlayer !== "human") {
      setDrag(null);
    }
  }, [game.phase, game.currentPlayer]);

  function playHumanMove(move: DominoMove) {
    const nextBoard = applyMove(game.board, move);
    const nextHand = removeTileFromHand(game.humanHand, move.tile.id);
    const nextBoardStart = move.side === "left" ? game.boardStartIndex - 1 : game.boardStartIndex;

    if (nextHand.length === 0) {
      const { nextGame, matchWinner } = settleRound(
        {
          ...game,
          board: nextBoard,
          boardStartIndex: nextBoardStart,
          humanHand: nextHand,
          consecutivePasses: 0,
          log: pushLog(
            game.log,
            `You dragged ${describeTile(move.tile)} onto the ${move.side} end and went out.`,
          ),
        },
        resolvePlayedOutRound("human", nextHand, game.cpuHand),
      );

      if (matchWinner) {
        recordMatchWin(matchWinner);
      }

      setGame(nextGame);
      return;
    }

    setGame({
      ...game,
      board: nextBoard,
      boardStartIndex: nextBoardStart,
      requiredOpeningTileId: null,
      humanHand: nextHand,
      currentPlayer: "cpu",
      humanBlockedEnds: [],
      consecutivePasses: 0,
      status: `You placed ${describeTile(move.tile)} on the ${move.side} end. CPU is thinking.`,
      log: pushLog(game.log, `You placed ${describeTile(move.tile)} on the ${move.side} end.`),
    });
  }

  function handlePass() {
    if (!canPass) {
      return;
    }

    const ends = getBoardEnds(game.board);
    const nextPassCount = game.consecutivePasses + 1;

    if (nextPassCount >= 2) {
      const { nextGame, matchWinner } = settleRound(
        {
          ...game,
          consecutivePasses: nextPassCount,
          log: pushLog(game.log, "You passed."),
        },
        resolveBlockedRound(game.humanHand, game.cpuHand),
      );

      if (matchWinner) {
        recordMatchWin(matchWinner);
      }

      setGame(nextGame);
      return;
    }

    setGame({
      ...game,
      currentPlayer: "cpu",
      humanBlockedEnds: ends ? [ends.left, ends.right] : [],
      consecutivePasses: nextPassCount,
      status: "You passed. CPU is thinking.",
      log: pushLog(game.log, "You passed."),
    });
  }

  const latestEvents = game.log.slice(0, 5);
  const dropState =
    drag && draggedTile
      ? {
          left: canDropLeft ? "valid" : "invalid",
          right: canDropRight ? "valid" : "invalid",
        }
      : {
          left: "idle",
          right: "idle",
        };
  const intermissionHeading =
    game.roundOutcome?.winner === "draw"
      ? "Round drawn"
      : game.roundOutcome?.winner === "human"
        ? "Round to you"
        : "Round to CPU";
  const intermissionLabel = game.matchWinner ? "New match deals in" : "Next round deals in";

  return (
    <main className="table-shell table-shell--wide">
      <section className="glass-panel match-bar">
        <div className="match-bar__intro">
          <p className="eyebrow">Single-player domino match</p>
          <h1>Domino Duel</h1>
          <p className="hero-copy">
            Drag tiles onto either open end. If neither player can move and both pass, the lower
            pip total wins the round. First to {MATCH_TARGET} wins the match.
          </p>
        </div>

        <div className="score-grid score-grid--match">
          <article className="score-card score-card--emphasis">
            <span className="score-card__label">Player</span>
            <strong>{game.matchScore.human}</strong>
            <span className="score-card__meta">Match points</span>
          </article>
          <article className="score-card score-card--emphasis">
            <span className="score-card__label">CPU</span>
            <strong>{game.matchScore.cpu}</strong>
            <span className="score-card__meta">Match points</span>
          </article>
          <article className="score-card">
            <span className="score-card__label">Player</span>
            <strong>{wins.human}</strong>
            <span className="score-card__meta">Matches won</span>
          </article>
          <article className="score-card">
            <span className="score-card__label">CPU</span>
            <strong>{wins.cpu}</strong>
            <span className="score-card__meta">Matches won</span>
          </article>
        </div>

        <div className="match-bar__controls">
          <button type="button" className="primary-button" onClick={startNextRound}>
            {game.phase === "intermission"
              ? game.matchWinner
                ? "Start new match now"
                : "Deal next round now"
              : "Redeal round"}
          </button>
          <button type="button" className="secondary-button" onClick={resetCurrentMatch}>
            Reset match
          </button>
          <button type="button" className="secondary-button" onClick={resetWins}>
            Reset wins
          </button>
        </div>
      </section>

      <section className="glass-panel table-panel">
        <div className="table-toolbar">
          <div>
            <p className="panel-title">Table status</p>
            <p className="status-copy">{game.status}</p>
          </div>
          <div className="state-chip-row">
            <span className="state-chip">
              Turn: {game.phase === "intermission" ? "Intermission" : nameFor(game.currentPlayer)}
            </span>
            <span className="state-chip">Boneyard: {game.stock.length}</span>
            <span className="state-chip">Your pips: {handPipTotal(game.humanHand)}</span>
            <span className="state-chip">Target: {MATCH_TARGET}</span>
          </div>
        </div>

        <section className="rack rack--cpu">
          <div className="rack__header">
            <div>
              <p className="panel-title">CPU rack</p>
              <p className="hand-meta">
                {game.cpuHand.length} tiles
                {game.phase === "intermission" ? `, ${handPipTotal(game.cpuHand)} pips` : ""}
              </p>
            </div>
          </div>

          <div className="rack__tiles rack__tiles--cpu">
            {game.cpuHand.map((tile) =>
              game.phase === "intermission" ? (
                <VisibleDomino
                  key={tile.id}
                  values={[tile.a, tile.b]}
                  compact
                  ariaLabel={`CPU tile ${describeTile(tile)}`}
                />
              ) : (
                <HiddenDomino key={tile.id} compact />
              ),
            )}
          </div>
        </section>

        <section className="board-area">
          <div className="board-area__header">
            <div>
              <p className="panel-title">Board</p>
              <p className="hand-meta">
                Drag any tile to an end. If nothing fits, pass. Two consecutive passes end the
                round.
              </p>
            </div>

            {boardEnds ? (
              <div className="end-caps">
                <span className="end-cap">Left {boardEnds.left}</span>
                <span className="end-cap">Right {boardEnds.right}</span>
              </div>
            ) : null}
          </div>

          <div
            className="board-canvas"
            style={{
              gridTemplateColumns: `repeat(${BOARD_COLS}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${BOARD_ROWS}, minmax(0, 1fr))`,
            }}
          >
            {dropSlots.left && boardEnds ? (
              <div
                ref={leftDropRef}
                className={[
                  "drop-slot",
                  drag ? `drop-slot--${dropState.left}` : "",
                  drag?.overSide === "left" ? "drop-slot--hovered" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  gridColumn: dropSlots.left.x + 1,
                  gridRow: dropSlots.left.y + 1,
                }}
              >
                <span>{boardEnds.left}</span>
              </div>
            ) : null}

            {dropSlots.right && boardEnds ? (
              <div
                ref={rightDropRef}
                className={[
                  "drop-slot",
                  drag ? `drop-slot--${dropState.right}` : "",
                  drag?.overSide === "right" ? "drop-slot--hovered" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  gridColumn: dropSlots.right.x + 1,
                  gridRow: dropSlots.right.y + 1,
                }}
              >
                <span>{boardEnds.right}</span>
              </div>
            ) : null}

            {!boardEnds && game.phase === "playing" && game.currentPlayer === "human" ? (
              <div
                ref={rightDropRef}
                className={[
                  "drop-slot",
                  drag ? `drop-slot--${dropState.right}` : "",
                  drag?.overSide === "right" ? "drop-slot--hovered" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  gridColumn: BOARD_PATH[BOARD_ANCHOR].x + 1,
                  gridRow: BOARD_PATH[BOARD_ANCHOR].y + 1,
                }}
              >
                <span>Start</span>
              </div>
            ) : null}

            {boardLayout.map((entry, index) => (
              <div
                key={`${entry.tile.tile.id}-${index}`}
                className="board-node"
                style={{
                  gridColumn: entry.x + 1,
                  gridRow: entry.y + 1,
                }}
              >
                <VisibleDomino
                  values={
                    entry.flipped
                      ? [entry.tile.right, entry.tile.left]
                      : [entry.tile.left, entry.tile.right]
                  }
                  compact
                  orientation={entry.orientation}
                  className="board-node__tile"
                  ariaLabel={`Board tile ${entry.tile.left}-${entry.tile.right}`}
                />
              </div>
            ))}
          </div>
        </section>

        <div className="activity-strip">
          {latestEvents.map((entry, index) => (
            <span key={`${index}-${entry}`} className="activity-pill">
              {entry}
            </span>
          ))}
        </div>

        <section className="rack rack--player">
          <div className="rack__header">
            <div>
              <p className="panel-title">Your rack</p>
              <p className="hand-meta">
                {game.humanHand.length} tiles, {handPipTotal(game.humanHand)} pips
              </p>
            </div>
          </div>

          <div className="rack__tiles rack__tiles--player">
            {game.humanHand.map((tile, index) => (
              <VisibleDomino
                key={tile.id}
                values={[tile.a, tile.b]}
                onPointerDown={
                  playableTileIds.has(tile.id)
                    ? (event) => handlePointerDown(event, tile)
                    : undefined
                }
                selected={drag?.tileId === tile.id}
                playable={playableTileIds.has(tile.id)}
                dimmed={humanMoves.length > 0 && !playableTileIds.has(tile.id)}
                className={`rack-tile rack-tile--${index % 3}`}
                ariaLabel={`Your tile ${describeTile(tile)}`}
              />
            ))}
          </div>

          <div className="rack__actions">
            <p className="hand-meta">
              {canPass
                ? "No legal move available. Pass to hand the turn to CPU."
                : "Pass becomes available only when none of your tiles fit the board."}
            </p>
            <button
              type="button"
              className="secondary-button"
              onClick={handlePass}
              disabled={!canPass}
            >
              Pass
            </button>
          </div>
        </section>

        {game.phase === "intermission" && game.roundOutcome ? (
          <div className="intermission-screen">
            <div className="intermission-card">
              <div className="intermission-card__top">
                <div>
                  <p className="eyebrow">Round complete</p>
                  <h2>{intermissionHeading}</h2>
                  <p className="intermission-copy">{game.roundOutcome.reason}</p>
                </div>
                <div className="intermission-countdown" aria-label={`${intermissionCountdown} seconds`}>
                  <span>{intermissionCountdown}</span>
                </div>
              </div>

              <div className="intermission-grid">
                <article className="intermission-score">
                  <span>Player total</span>
                  <strong>{game.matchScore.human}</strong>
                  <small>{game.roundOutcome.humanPips} pips left this round</small>
                </article>
                <article className="intermission-score">
                  <span>CPU total</span>
                  <strong>{game.matchScore.cpu}</strong>
                  <small>{game.roundOutcome.cpuPips} pips left this round</small>
                </article>
              </div>

              <div className="intermission-award">
                <span className="intermission-award__label">Round points</span>
                <strong>
                  {game.roundOutcome.pointsAwarded} point
                  {game.roundOutcome.pointsAwarded === 1 ? "" : "s"}
                </strong>
                {game.matchWinner ? (
                  <span className="intermission-award__meta">
                    {nameFor(game.matchWinner)} won the match. Wins updated and a fresh match starts
                    after the countdown.
                  </span>
                ) : (
                  <span className="intermission-award__meta">
                    {intermissionLabel} {intermissionCountdown}.
                  </span>
                )}
              </div>

              <div className="intermission-progress" aria-hidden="true">
                <span />
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {drag && draggedTile ? (
        <div className="drag-layer" aria-hidden="true">
          <VisibleDomino
            values={[draggedTile.a, draggedTile.b]}
            className="drag-ghost"
            style={{
              left: drag.x - drag.offsetX,
              top: drag.y - drag.offsetY,
              position: "fixed",
            }}
          />
        </div>
      ) : null}
    </main>
  );
}

function createRound(matchScore: Scoreboard): GameState {
  const { humanHand, cpuHand, stock } = dealRound();
  const opener = chooseOpeningTile(humanHand, cpuHand);
  const openingPlacement =
    opener.player === "cpu" ? createPlacement([], opener.tile, "right") : null;
  const nextHumanHand = humanHand;
  const nextCpuHand = opener.player === "cpu" ? removeTileFromHand(cpuHand, opener.tile.id) : cpuHand;

  return {
    phase: "playing",
    currentPlayer: "human",
    board: openingPlacement ? [openingPlacement] : [],
    boardStartIndex: BOARD_ANCHOR,
    requiredOpeningTileId: opener.player === "human" ? opener.tile.id : null,
    humanHand: nextHumanHand,
    cpuHand: nextCpuHand,
    stock,
    humanBlockedEnds: [],
    consecutivePasses: 0,
    status:
      opener.player === "human"
        ? `You open this round with ${describeTile(opener.tile)}. Drag it to the start slot.`
        : `CPU opened with ${describeTile(opener.tile)}. Drag a tile to begin.`,
    log: [
      opener.player === "human"
        ? `You won the opening with ${describeTile(opener.tile)}.`
        : `CPU opened the round with ${describeTile(opener.tile)}.`,
    ],
    roundOutcome: null,
    matchScore,
    matchWinner: null,
  };
}

function settleRound(game: GameState, outcome: RoundOutcome) {
  const nextMatchScore = { ...game.matchScore };

  if (outcome.winner !== "draw") {
    nextMatchScore[outcome.winner] += outcome.pointsAwarded;
  }

  const matchWinner: PlayerId | null =
    nextMatchScore.human >= MATCH_TARGET
      ? "human"
      : nextMatchScore.cpu >= MATCH_TARGET
        ? "cpu"
        : null;
  const status = buildRoundStatus(outcome, nextMatchScore, matchWinner);

  return {
    nextGame: {
      ...game,
      phase: "intermission" as const,
      humanBlockedEnds: [],
      consecutivePasses: 0,
      status,
      log: pushLog(
        game.log,
        outcome.winner === "draw"
          ? "Round drawn."
          : outcome.winner === "human"
            ? `You scored ${outcome.pointsAwarded} points.`
            : `CPU scored ${outcome.pointsAwarded} points.`,
      ),
      roundOutcome: outcome,
      matchScore: nextMatchScore,
      matchWinner,
    },
    matchWinner,
  };
}

function runCpuTurn(game: GameState) {
  const cpuHand = [...game.cpuHand];
  const legalMoves = getLegalMoves(cpuHand, game.board);

  if (legalMoves.length > 0) {
    const move =
      chooseCpuMove(cpuHand, game.board, {
        humanBlockedEnds: game.humanBlockedEnds,
        stockCount: game.stock.length,
        opponentHandCount: game.humanHand.length,
      }) ?? legalMoves[0];
    const nextBoard = applyMove(game.board, move);
    const nextHand = removeTileFromHand(cpuHand, move.tile.id);
    const nextBoardStart = move.side === "left" ? game.boardStartIndex - 1 : game.boardStartIndex;

    if (nextHand.length === 0) {
      return settleRound(
        {
          ...game,
          board: nextBoard,
          boardStartIndex: nextBoardStart,
          cpuHand: nextHand,
          consecutivePasses: 0,
          log: pushLog(
            game.log,
            `CPU placed ${describeTile(move.tile)} on the ${move.side} end and went out.`,
          ),
        },
        resolvePlayedOutRound("cpu", game.humanHand, nextHand),
      );
    }

    return {
      nextGame: {
        ...game,
        board: nextBoard,
        boardStartIndex: nextBoardStart,
        cpuHand: nextHand,
        currentPlayer: "human" as const,
        consecutivePasses: 0,
        status: `CPU placed ${describeTile(move.tile)} on the ${move.side} end. Your turn.`,
        log: pushLog(game.log, `CPU placed ${describeTile(move.tile)} on the ${move.side} end.`),
      },
      matchWinner: null,
    };
  }

  const nextPassCount = game.consecutivePasses + 1;

  if (nextPassCount >= 2) {
    return settleRound(
      {
        ...game,
        consecutivePasses: nextPassCount,
        log: pushLog(game.log, "CPU passed."),
      },
      resolveBlockedRound(game.humanHand, cpuHand),
    );
  }

  return {
    nextGame: {
      ...game,
      cpuHand,
      currentPlayer: "human" as const,
      consecutivePasses: nextPassCount,
      status: "CPU passed. Your turn.",
      log: pushLog(game.log, "CPU passed."),
    },
    matchWinner: null,
  };
}

function buildRoundStatus(
  outcome: RoundOutcome,
  matchScore: Scoreboard,
  matchWinner: PlayerId | null,
) {
  if (outcome.winner === "draw") {
    return `${outcome.reason} No match points were scored.`;
  }

  const scorer = outcome.winner === "human" ? "You" : "CPU";
  const scoreLine = `${scorer} scored ${outcome.pointsAwarded} point${
    outcome.pointsAwarded === 1 ? "" : "s"
  }. Match score is ${matchScore.human}-${matchScore.cpu}.`;

  if (matchWinner) {
    return `${outcome.reason} ${scoreLine} ${nameFor(matchWinner)} won the match.`;
  }

  return `${outcome.reason} ${scoreLine}`;
}

function pushLog(log: string[], entry: string) {
  return [entry, ...log].slice(0, 8);
}

function nameFor(player: PlayerId) {
  return player === "human" ? "Player" : "CPU";
}

function createSnakePath(cols: number, rows: number) {
  const path: PathCell[] = [];

  for (let y = 0; y < rows; y += 1) {
    if (y % 2 === 0) {
      for (let x = 0; x < cols; x += 1) {
        path.push({ x, y });
      }
    } else {
      for (let x = cols - 1; x >= 0; x -= 1) {
        path.push({ x, y });
      }
    }
  }

  return path;
}

function layoutBoard(board: PlacedDomino[], boardStartIndex: number): BoardLayoutTile[] {
  return board.map((tile, index) => {
    const cell = BOARD_PATH[boardStartIndex + index];
    const next = BOARD_PATH[boardStartIndex + index + 1] ?? null;
    const previous = BOARD_PATH[boardStartIndex + index - 1] ?? null;
    const direction = getTileDirection(cell, next, previous);

    return {
      tile,
      x: cell.x,
      y: cell.y,
      orientation: direction === "left" || direction === "right" ? "horizontal" : "vertical",
      flipped: direction === "left" || direction === "up",
    };
  });
}

function getDropSlots(board: PlacedDomino[], boardStartIndex: number) {
  if (!board.length) {
    return { left: null, right: null };
  }

  const leftCell = BOARD_PATH[boardStartIndex - 1] ?? null;
  const rightCell = BOARD_PATH[boardStartIndex + board.length] ?? null;
  const firstCell = BOARD_PATH[boardStartIndex];
  const lastCell = BOARD_PATH[boardStartIndex + board.length - 1];

  const left: DropSlot | null = leftCell
    ? {
        ...leftCell,
        side: "left",
        orientation: leftCell.y === firstCell.y ? "horizontal" : "vertical",
      }
    : null;
  const right: DropSlot | null = rightCell
    ? {
        ...rightCell,
        side: "right",
        orientation: rightCell.y === lastCell.y ? "horizontal" : "vertical",
      }
    : null;

  return { left, right };
}

function getTileDirection(
  cell: PathCell,
  next: PathCell | null,
  previous: PathCell | null,
): PathDirection {
  if (previous) {
    return directionBetween(previous, cell);
  }

  if (next) {
    return directionBetween(cell, next);
  }

  return "right";
}

function directionBetween(from: PathCell, to: PathCell): PathDirection {
  if (to.x > from.x) {
    return "right";
  }

  if (to.x < from.x) {
    return "left";
  }

  if (to.y > from.y) {
    return "down";
  }

  return "up";
}

function detectDropSide(
  x: number,
  y: number,
  leftDropRef: RefObject<HTMLDivElement | null>,
  rightDropRef: RefObject<HTMLDivElement | null>,
): BoardSide | null {
  if (isPointInElement(x, y, leftDropRef.current)) {
    return "left";
  }

  if (isPointInElement(x, y, rightDropRef.current)) {
    return "right";
  }

  return null;
}

function isPointInElement(x: number, y: number, element: HTMLDivElement | null) {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function findMoveForTileAndSide(moves: DominoMove[], tileId: string, side: BoardSide) {
  return moves.find((move) => move.tile.id === tileId && move.side === side) ?? null;
}
