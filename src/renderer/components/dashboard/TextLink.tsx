import { ArrowRight } from "lucide-react";

interface TextLinkProps {
  label: string;
  onClick: () => void;
  /** Accessible name when the visible label alone is ambiguous ("All"). */
  ariaLabel?: string;
}

/** In-app navigation styled as an accent text link with a trailing arrow. */
export function TextLink(props: TextLinkProps): JSX.Element {
  return (
    <button type="button" className="text-link" onClick={props.onClick} aria-label={props.ariaLabel}>
      {props.label}
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}
