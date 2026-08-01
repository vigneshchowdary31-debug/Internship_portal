/**
 * Welcome-screen acknowledgement.
 *
 * Lives in its own module rather than alongside `WelcomePage` so the router
 * guard and the login screen can read it without statically importing the page
 * component — importing it there would defeat the route's lazy chunking.
 *
 * sessionStorage rather than a server field: this is one-time onboarding
 * chrome, not an access-control decision. Losing the flag simply shows a
 * friendly screen again, which does not warrant a database column.
 */
const WELCOME_SEEN_KEY = 'welcome-acknowledged';

export function markWelcomeSeen(userId: string): void {
  try {
    sessionStorage.setItem(WELCOME_SEEN_KEY, userId);
  } catch {
    // Private browsing or a storage quota error. The screen simply reappears.
  }
}

export function hasSeenWelcome(userId: string): boolean {
  try {
    return sessionStorage.getItem(WELCOME_SEEN_KEY) === userId;
  } catch {
    return false;
  }
}
