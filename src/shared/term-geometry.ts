/**
 * The one geometry floor, shared by the renderer (TerminalPane fit guard) and
 * the main process (PTY spawn/resize clamp). Two sides, one constant — a floor
 * the other side cannot see is what caused the 80×24-vs-fit desync fixed in
 * 1.3.5, so this module exists to keep the numbers in lockstep.
 */
export const PTY_MIN_COLS = 20
export const PTY_MIN_ROWS = 8

/**
 * Smallest pane box (CSS px, border box incl. the 1px borders and padding)
 * that can still host a 20×8 terminal at the app's ~9px/cell. A pane below
 * this must not drive fit()/resize — the PTY would reflow to the floor and
 * ConPTY repaints a TUI as one letter per line.
 */
export const MIN_PANE_W = 190
export const MIN_PANE_H = 92

export function paneUnderMin(w: number, h: number): boolean {
  return w < MIN_PANE_W || h < MIN_PANE_H
}
