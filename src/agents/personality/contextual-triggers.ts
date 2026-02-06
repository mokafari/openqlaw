/**
 * Contextual Triggers - Event-to-Personality Trait Mapping
 *
 * Maps system events to personality traits based on SOUL.md,
 * allowing the agent to adapt its behavior based on context.
 */

import type { SoulPersonality } from "./soul-loader.js";

export type SystemEvent =
  | "BUILD_FAILURE"
  | "LATE_NIGHT"
  | "ERROR_RECOVERY"
  | "SUCCESS"
  | "USER_WAITING"
  | "COMPLEX_TASK"
  | "SIMPLE_TASK";

export type PersonalityTrait =
  | "Encouraging"
  | "Cynical"
  | "Brief"
  | "Detailed"
  | "Resilient"
  | "Cautious"
  | "Helpful"
  | "Direct";

/**
 * Map system events to personality traits
 */
export function getTraitForEvent(
  event: SystemEvent,
  soul: SoulPersonality | null,
): PersonalityTrait[] {
  const traits: PersonalityTrait[] = [];

  if (!soul) {
    // Default behavior without SOUL.md
    return getDefaultTraitsForEvent(event);
  }

  const soulTraits = soul.traits ?? [];
  const lowerTraits = soulTraits.map((t) => t.toLowerCase());

  switch (event) {
    case "BUILD_FAILURE":
      if (lowerTraits.includes("encouraging")) {
        traits.push("Encouraging");
      } else if (lowerTraits.includes("cynical")) {
        traits.push("Cynical");
      } else {
        traits.push("Resilient"); // Default to resilient
      }
      break;

    case "LATE_NIGHT":
      if (lowerTraits.includes("brief")) {
        traits.push("Brief");
      } else {
        traits.push("Brief"); // Always brief at night
      }
      break;

    case "ERROR_RECOVERY":
      if (lowerTraits.includes("resilient")) {
        traits.push("Resilient");
      } else if (lowerTraits.includes("cautious")) {
        traits.push("Cautious");
      } else {
        traits.push("Resilient"); // Default to resilient
      }
      break;

    case "SUCCESS":
      traits.push("Helpful"); // Always helpful on success
      break;

    case "USER_WAITING":
      traits.push("Brief"); // Be brief when user is waiting
      break;

    case "COMPLEX_TASK":
      if (lowerTraits.includes("detailed")) {
        traits.push("Detailed");
      } else {
        traits.push("Helpful"); // Default to helpful
      }
      break;

    case "SIMPLE_TASK":
      if (lowerTraits.includes("brief")) {
        traits.push("Brief");
      } else {
        traits.push("Direct"); // Default to direct
      }
      break;
  }

  // Apply response style
  if (soul.responseStyle === "brief") {
    traits.push("Brief");
  } else if (soul.responseStyle === "detailed") {
    traits.push("Detailed");
  }

  return traits.length > 0 ? traits : getDefaultTraitsForEvent(event);
}

/**
 * Get default traits for events (when no SOUL.md)
 */
function getDefaultTraitsForEvent(event: SystemEvent): PersonalityTrait[] {
  switch (event) {
    case "BUILD_FAILURE":
      return ["Resilient"];
    case "LATE_NIGHT":
      return ["Brief"];
    case "ERROR_RECOVERY":
      return ["Resilient"];
    case "SUCCESS":
      return ["Helpful"];
    case "USER_WAITING":
      return ["Brief"];
    case "COMPLEX_TASK":
      return ["Helpful"];
    case "SIMPLE_TASK":
      return ["Direct"];
    default:
      return ["Helpful"];
  }
}

/**
 * Check if it's late night (for LATE_NIGHT event)
 */
export function isLateNight(hour?: number): boolean {
  const now = hour ?? new Date().getHours();
  return now >= 22 || now < 6; // 10 PM to 6 AM
}
