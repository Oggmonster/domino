import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

type VisibleDominoProps = {
  values: [number, number];
  onClick?: () => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  selected?: boolean;
  playable?: boolean;
  dimmed?: boolean;
  compact?: boolean;
  orientation?: "horizontal" | "vertical";
  className?: string;
  style?: CSSProperties;
  ariaLabel?: string;
};

const PIP_LAYOUTS: Record<number, number[]> = {
  0: [],
  1: [5],
  2: [1, 9],
  3: [1, 5, 9],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

export function VisibleDomino({
  values,
  onClick,
  onPointerDown,
  selected = false,
  playable = false,
  dimmed = false,
  compact = false,
  orientation = "horizontal",
  className = "",
  style,
  ariaLabel,
}: VisibleDominoProps) {
  const classNames = [
    "domino-face",
    compact ? "domino-face--compact" : "",
    playable ? "domino-face--playable" : "",
    selected ? "domino-face--selected" : "",
    dimmed ? "domino-face--dimmed" : "",
    orientation === "vertical" ? "domino-face--vertical" : "",
    onClick || onPointerDown ? "domino-face--interactive" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      <div className="domino-face__shine" aria-hidden="true" />
      <DominoHalf value={values[0]} />
      <div className="domino-face__divider" />
      <DominoHalf value={values[1]} />
    </>
  );

  if (onClick || onPointerDown) {
    return (
      <button
        type="button"
        className={classNames}
        onClick={onClick}
        onPointerDown={onPointerDown}
        style={style}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={classNames} style={style} aria-label={ariaLabel}>
      {content}
    </div>
  );
}

export function HiddenDomino({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`domino-back ${compact ? "domino-back--compact" : ""}`}>
      <div className="domino-back__shine" />
      <div className="domino-back__seal" aria-hidden="true" />
    </div>
  );
}

function DominoHalf({ value }: { value: number }) {
  return (
    <div className="domino-half">
      <div className="pip-grid" aria-hidden="true">
        {Array.from({ length: 9 }, (_, index) => index + 1).map((slot) => (
          <span
            key={slot}
            className={`pip ${PIP_LAYOUTS[value].includes(slot) ? "pip--filled" : ""}`}
          />
        ))}
      </div>
    </div>
  );
}
