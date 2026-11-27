
export type RobotState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export interface LiveCaptions {
  userText: string;
  robotText: string;
}
