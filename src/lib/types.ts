export interface BranchInfo {
  name: string
  isCurrent: boolean
  lastCommitAge: string
  lastCommitMsg: string
  ahead: number
  behind: number
}

export interface Project {
  path: string
  name: string
  branch: string
  commitAge: string
  commitMsg: string
  commitEpoch: number
  dirty: string
  ahead: number
  behind: number
  claudeAgo: string
  claudeLastMs: number
  sessionCount: number
  totalMessages: number
  tags: string
  activeSessions: number
  busySessions: number
  lastActivityMs: number
  expanded: boolean
  sessions: SessionInfo[] | null
  branches: BranchInfo[] | null
}

export interface SessionInfo {
  id: string
  timestamp: number
  title: string
  lastUserPrompt: string
  lastAssistantMsg: string
  branch: string
  sizeBytes: number
}

export interface DisplayRow {
  type: "project" | "session" | "new-session" | "branch"
  projectIndex: number
  sessionIndex?: number
  branchName?: string
}
