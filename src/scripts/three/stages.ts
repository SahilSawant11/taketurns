/**
 * Hero stages in scroll progress (0–1): mandrel, veil, winding, cure, off the
 * mandrel (lift), into service (on the scrubber), in the plant (aerial).
 */
export const STAGE_P = [0, 0.08, 0.17, 0.43, 0.52, 0.67, 0.83, 1];
/**
 * Each stage opens with a camera move (first MOVE share of the stage), then
 * holds the camera still while the process itself advances, so captions can
 * be read without the frame shifting.
 */
export const MOVE = 0.3;
/** A representative progress per stage (camera settled), for step jumps and the still frame. */
export const STAGE_FOCUS = [0.04, 0.15, 0.33, 0.48, 0.615, 0.8, 0.95];
