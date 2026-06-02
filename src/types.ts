export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type Lesson = {
  id: string;
  order: number;
  roadmapId?: string;
  roadmapIndex?: number;
  sourceDir?: string;
  title: string;
  language: string;
  description: string;
  goal: string;
  steps: string[];
  hints: string[];
  skillsIntroduced?: string[];
  skillsPracticed?: string[];
  prerequisites?: string[];
  difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
  remediation?: string;
  entryFile: string;
  checkpoint?: {
    command: string;
    expectedOutput?: string;
  };
};

export type Roadmap = {
  id: string;
  topic: string;
  level: string;
  language: string;
  outcome: string;
  pace: string;
  goalType?: string;
  skillGap?: {
    actualLevel: string;
    missingPrerequisites: string[];
    estimatedDifficulty?: string;
  };
  capstone?: {
    capstone: string;
    skillsRequired: string[];
  };
  courseSource?: string;
  courseTrack?: {
    id: string;
    label: string;
    sourceUrl: string;
    exerciseUrl?: string;
  } | null;
  timePlan?: {
    pace: string;
    weeklyMinutes: number;
    targetWeeks: number;
    maxLessons: number;
    minutesPerLesson: number;
    depthLabel: string;
  };
  depthLevel?: string;
  topicOrder?: string[];
  milestones?: Array<{
    milestone: string;
    modules: Array<{
      title: string;
      objective: string;
      task: string;
      artifact: string;
      validation: string;
      estimatedHours?: number;
      skillsIntroduced?: string[];
      skillsPracticed?: string[];
      prerequisites?: string[];
      difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
      remediation?: string;
      estimatedMinutes?: number;
      w3schoolsTopic?: string;
      sourceUrl?: string;
      exerciseUrl?: string;
    }>;
    checkpoint: string;
    miniProject: string;
  }>;
  quality?: {
    validated: boolean;
    issues: string[];
  };
  currentIndex: number;
  createdAt: string;
  completedAt?: string;
  createdLessonIds: string[];
  skippedLessonIds: string[];
  modules: Array<{
    index: number;
    title: string;
    goal: string;
    objective?: string;
    level: string;
    outcome: string;
    task?: string;
    artifact?: string;
    validation?: string;
    milestone?: string;
    estimatedHours?: number;
    skillsIntroduced?: string[];
    skillsPracticed?: string[];
    prerequisites?: string[];
    difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
    remediation?: string;
    estimatedMinutes?: number;
    w3schoolsTopic?: string;
    sourceUrl?: string;
    exerciseUrl?: string;
    test?: string;
  }>;
};

export type RoadmapAnswers = {
  topic?: string;
  level?: string;
  language?: string;
  outcome?: string;
  pace?: string;
  goal?: string;
  experience?: string;
  stack?: string;
  depth?: string;
  learningStyle?: string;
  constraints?: string;
};

export type OpenTab = {
  path: string;
  content: string;
  savedContent: string;
};

export type LearningStatus =
  | "locked"
  | "ready"
  | "in_progress"
  | "ran"
  | "failed_check"
  | "passed_check"
  | "skipped"
  | "needs_review"
  | "mastered"
  | "blocked";

export type ProgressEntry = {
  completed: boolean;
  completedAt?: string;
  status: LearningStatus;
  runAttempts: number;
  checkAttempts: number;
  hintCount: number;
  lastRunAt?: string;
  lastCheckAt?: string;
  lastError?: string;
  lastOutput?: string;
  masteryScore: number;
  timeSpentSeconds: number;
};

export type ProgressEvent = {
  verb: "opened" | "ran" | "checked" | "hinted" | "skipped" | "created";
  lessonId?: string;
  roadmapId?: string;
  success?: boolean;
  output?: string;
  error?: string;
  durationSeconds?: number;
  context?: Record<string, unknown>;
};

export type ProgressMap = Record<string, ProgressEntry>;

export type TutorMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  passed?: boolean;
  output?: string;
  progress?: ProgressMap;
};

export type InterviewTurn = {
  field: string;
  question: string;
  answer: string;
  rawAnswer?: string;
  normalizedAnswer?: string;
  isVague?: boolean;
  clarificationOf?: string;
  confidence?: number;
  evidence?: string[];
};

export type InterviewPrompt = {
  complete: boolean;
  mode: "ollama" | "fallback";
  nextField?: string;
  fieldOrder?: string[];
  completedFields?: string[];
  fieldConfidence?: Record<string, number>;
  inferredIntent?: string[];
  diagnostic?: {
    recommended: boolean;
    reason?: string;
    questions?: string[];
  };
  field?: string;
  question?: string;
  helper?: string;
  suggestions?: string[];
  summary?: RoadmapAnswers;
  w3schoolsTrack?: {
    label: string;
    sourceUrl: string;
    exerciseUrl?: string;
  } | null;
};
