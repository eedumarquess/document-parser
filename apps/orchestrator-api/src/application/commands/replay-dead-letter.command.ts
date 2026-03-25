export type ReplayDeadLetterCommand = {
  dlqEventId: string;
  reason: string;
};
