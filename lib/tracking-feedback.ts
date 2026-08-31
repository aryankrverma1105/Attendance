export function shouldEscalateTrackingPermission(input: { mode: "idle" | "foreground" | "background"; reason?: string }) {
  return input.mode === "idle" && input.reason === "permission-denied";
}

export function trackingOutcomeMessage(input: { action: "check-in" | "check-out"; mode?: "idle" | "foreground" | "background"; reason?: string; trackingStopped?: boolean }) {
  if (input.action === "check-out") {
    return input.trackingStopped
      ? "Your photo and GPS evidence have been saved, and route tracking has stopped for this attendance shift."
      : "Your photo and GPS evidence have been saved to the secure sync queue.";
  }
  if (input.mode === "background") return "Your photo and GPS evidence have been saved. Route tracking has started and continues under the Android tracking notification.";
  if (input.mode === "foreground") return "Your photo and GPS evidence have been saved. Route tracking has started while Sologix remains open.";
  if (input.reason === "permission-denied") return "Your attendance was saved, but route tracking is paused because location permission was denied. Your manager and administrator have been alerted.";
  return "Your photo and GPS evidence have been saved. Route tracking is paused until required location access is available.";
}
