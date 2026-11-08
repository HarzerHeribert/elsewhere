/** Finite intentions shared by touch controls and the scene input controller. */
export type WorldControlAction =
  | 'turn-left'
  | 'turn-right'
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'stop';
export interface WorldControlCommand {
  action: WorldControlAction;
  serial: number;
}
