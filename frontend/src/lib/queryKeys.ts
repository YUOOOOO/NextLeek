export const queryKeys = {
  authStatus: ["auth", "status"] as const,
  me: ["auth", "me"] as const,
  users: ["users"] as const,
  dataStatus: ["data", "status"] as const,
  pipelineJobs: ["pipeline", "jobs"] as const,
  pipelineJob: (id: string) => ["pipeline", "job", id] as const,
  settings: ["settings"] as const,
  preferences: ["settings", "preferences"] as const,
  dataSources: ["settings", "data-sources"] as const,
  capabilityMatrix: ["settings", "capability-matrix"] as const,
};
