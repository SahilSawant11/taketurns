/** Winding stages in scroll progress (0–1): mandrel, veil, winding, cure, finished. */
export const STAGE_P = [0, 0.12, 0.26, 0.7, 0.84, 1];
/**
 * Each stage opens with a camera move (first MOVE share of the stage), then
 * holds the camera still while the process itself advances, so captions can
 * be read without the frame shifting.
 */
export const MOVE = 0.3;
/** A representative progress per stage (camera settled), for step jumps and the still frame. */
export const STAGE_FOCUS = [0.05, 0.23, 0.52, 0.8, 0.95];
