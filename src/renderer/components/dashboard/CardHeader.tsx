import type { ReactNode } from "react";

interface CardHeaderProps {
  /** Id of the heading, referenced by the card's `aria-labelledby`. */
  titleId: string;
  title: string;
  /** Optional trailing action, e.g. a `TextLink`. */
  action?: ReactNode;
}

/** Title row of a dashboard card: heading left, optional action right. */
export function CardHeader(props: CardHeaderProps): JSX.Element {
  return (
    <div className="dash-card-head">
      <h2 id={props.titleId}>{props.title}</h2>
      {props.action}
    </div>
  );
}
