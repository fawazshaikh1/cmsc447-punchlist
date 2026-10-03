import { Icon } from './Icon';

/**
 * The way back to a hidden side panel, shown on the edge the panel left from.
 *
 * ===========================================================================
 * WHY THIS EXISTS AS WELL AS THE RAIL'S "PANEL" BUTTON
 * ===========================================================================
 * The rail button was the only way back, and people did not find it. It sits
 * on the opposite side of the screen from where the panel was, and it looks
 * the same whether the panel is open or hidden — so after pressing the panel's
 * ×, nothing anywhere on screen changes to say "this is how you undo that".
 * Users look for the panel where they last saw it.
 *
 * So while the panel is hidden, a labelled control sits at the top right of
 * the stage, in the panel's place. The rail button stays: it is still the one
 * a thumb reaches on a tablet, and it works whether the panel is open or not.
 *
 * Rendered only while the panel is hidden — it is a way back, not a toggle, so
 * there is never a moment when it and the panel's × are both on screen.
 *
 * @param {object} props
 * @param {() => void} props.onShow
 */
export function PanelReveal({ onShow }) {
  return (
    <button
      type="button"
      className="panel-reveal"
      onClick={onShow}
      aria-label="Show panel"
      title="Show the side panel"
    >
      <Icon name="panel" size={18} />
      <span>Details</span>
    </button>
  );
}
