import type { ReactNode } from "react";

/** Signal colour of a dashboard element (tile, card border). */
export type Tone = "accent" | "info" | "warn" | "success" | "danger";

interface IconTileProps {
  tone: Tone;
  children: ReactNode;
}

/** Square tinted tile holding a card's leading icon. Decorative: the card's
 *  heading carries the meaning. */
export function IconTile(props: IconTileProps): JSX.Element {
  return (
    <span className={`icon-tile tone-${props.tone}`} aria-hidden="true">
      {props.children}
    </span>
  );
}
