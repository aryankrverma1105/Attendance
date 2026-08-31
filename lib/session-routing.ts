export function getSessionRedirect(input: { hasSession: boolean; onLoginScreen: boolean }) {
  if (!input.hasSession && !input.onLoginScreen) return "/login";
  if (input.hasSession && input.onLoginScreen) return "/(tabs)";
  return null;
}
