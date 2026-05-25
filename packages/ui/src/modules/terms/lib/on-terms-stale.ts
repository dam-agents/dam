let redirecting = false;

export function onTermsStale() {
  if (redirecting) return;
  if (window.location.pathname === "/terms") return;
  redirecting = true;
  window.location.assign("/terms");
}
