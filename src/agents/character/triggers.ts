/**
 * Character Triggers
 *
 * Event-to-personality mapping for contextual responses.
 * Inspired by Quake III Arena Bot's Eliza chat system.
 */

export type TriggerEvent =
  | "BUILD_FAILED"
  | "BUILD_SUCCESS"
  | "TEST_FAILED"
  | "TEST_PASSED"
  | "DEPLOYMENT_FAILED"
  | "DEPLOYMENT_SUCCESS"
  | "ERROR_OCCURRED"
  | "TASK_COMPLETED"
  | "LONG_RUNNING_TASK"
  | "LATE_NIGHT"
  | "EARLY_MORNING"
  | "USER_FRUSTRATED"
  | "USER_HAPPY"
  | "MENTIONED"
  | "FIRST_INTERACTION";

export type TriggerContext = {
  event: TriggerEvent;
  timestamp?: number;
  metadata?: Record<string, unknown>;
};

export type TriggerResponse = {
  template: string;
  tone: "encouraging" | "celebratory" | "analytical" | "concise" | "helpful" | "apologetic";
  variants?: string[]; // Alternative phrasings
};

export const TRIGGER_RESPONSES: Record<TriggerEvent, TriggerResponse> = {
  BUILD_FAILED: {
    template: "Build failed. Let me check the logs to see what went wrong.",
    tone: "analytical",
    variants: [
      "Build failed. Investigating the issue...",
      "Build error detected. Analyzing logs...",
      "The build didn't complete. Let me diagnose the problem.",
    ],
  },
  BUILD_SUCCESS: {
    template: "Build succeeded! ✅",
    tone: "celebratory",
    variants: [
      "Build completed successfully!",
      "✅ Build passed!",
      "Build finished without errors.",
    ],
  },
  TEST_FAILED: {
    template: "Some tests failed. Let me review which ones and why.",
    tone: "analytical",
    variants: ["Test failures detected. Analyzing...", "Tests didn't all pass. Investigating..."],
  },
  TEST_PASSED: {
    template: "All tests passed! ✅",
    tone: "celebratory",
    variants: ["Tests are green!", "✅ All tests passing."],
  },
  DEPLOYMENT_FAILED: {
    template: "Deployment failed. Checking the error details.",
    tone: "analytical",
    variants: ["Deployment error. Investigating...", "Deployment didn't complete. Diagnosing..."],
  },
  DEPLOYMENT_SUCCESS: {
    template: "Deployment successful! 🚀",
    tone: "celebratory",
    variants: ["Deployed successfully!", "🚀 Deployment complete!"],
  },
  ERROR_OCCURRED: {
    template: "An error occurred. Let me investigate.",
    tone: "analytical",
    variants: ["Error detected. Analyzing...", "Something went wrong. Checking..."],
  },
  TASK_COMPLETED: {
    template: "Task completed!",
    tone: "celebratory",
    variants: ["Done!", "✅ Completed.", "Finished!"],
  },
  LONG_RUNNING_TASK: {
    template: "This is taking a while. Providing a status update...",
    tone: "helpful",
    variants: [
      "Still working on this. Here's the current status...",
      "Taking longer than expected. Status update:",
    ],
  },
  LATE_NIGHT: {
    template: "It's getting late. I'll keep this brief.",
    tone: "concise",
    variants: ["Late night - keeping it short.", "Brief response (it's late):"],
  },
  EARLY_MORNING: {
    template: "Good morning!",
    tone: "helpful",
    variants: ["Morning!", "Good morning! How can I help?"],
  },
  USER_FRUSTRATED: {
    template: "I understand this is frustrating. Let me help resolve this.",
    tone: "apologetic",
    variants: [
      "Sorry for the trouble. Let me fix this.",
      "I see the issue. Working on a solution...",
    ],
  },
  USER_HAPPY: {
    template: "Glad I could help!",
    tone: "celebratory",
    variants: ["Happy to help!", "You're welcome!"],
  },
  MENTIONED: {
    template: "You mentioned me. How can I help?",
    tone: "helpful",
    variants: ["Yes?", "What can I do?"],
  },
  FIRST_INTERACTION: {
    template: "Hello! I'm here to help.",
    tone: "helpful",
    variants: ["Hi! Ready to assist.", "Hello! How can I help?"],
  },
};

export function getTriggerResponse(event: TriggerEvent): TriggerResponse {
  return (
    TRIGGER_RESPONSES[event] ?? {
      template: "Noted.",
      tone: "helpful",
    }
  );
}

export function selectTriggerVariant(response: TriggerResponse): string {
  if (response.variants && response.variants.length > 0) {
    // Randomly select a variant to avoid repetitive responses
    const index = Math.floor(Math.random() * (response.variants.length + 1));
    return index === 0 ? response.template : response.variants[index - 1];
  }
  return response.template;
}

export function detectTriggerEvent(context: {
  message?: string;
  error?: string;
  hour?: number;
  isFirstInteraction?: boolean;
  isMentioned?: boolean;
}): TriggerEvent | null {
  const { message, error, hour, isFirstInteraction, isMentioned } = context;

  if (isFirstInteraction) {
    return "FIRST_INTERACTION";
  }

  if (isMentioned) {
    return "MENTIONED";
  }

  if (error) {
    const errorLower = error.toLowerCase();
    if (errorLower.includes("build") || errorLower.includes("compile")) {
      return "BUILD_FAILED";
    }
    if (errorLower.includes("test")) {
      return "TEST_FAILED";
    }
    if (errorLower.includes("deploy")) {
      return "DEPLOYMENT_FAILED";
    }
    return "ERROR_OCCURRED";
  }

  if (message) {
    const msgLower = message.toLowerCase();
    if (
      msgLower.includes("build") &&
      (msgLower.includes("success") || msgLower.includes("passed"))
    ) {
      return "BUILD_SUCCESS";
    }
    if (msgLower.includes("test") && (msgLower.includes("pass") || msgLower.includes("green"))) {
      return "TEST_PASSED";
    }
    if (
      msgLower.includes("deploy") &&
      (msgLower.includes("success") || msgLower.includes("complete"))
    ) {
      return "DEPLOYMENT_SUCCESS";
    }
    if (
      msgLower.includes("done") ||
      msgLower.includes("complete") ||
      msgLower.includes("finished")
    ) {
      return "TASK_COMPLETED";
    }
  }

  if (hour !== undefined) {
    if (hour >= 22 || hour < 6) {
      return "LATE_NIGHT";
    }
    if (hour >= 6 && hour < 9) {
      return "EARLY_MORNING";
    }
  }

  return null;
}
