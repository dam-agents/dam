let redirecting = false;
let termsStale = false;

export function isTermsStale(): boolean {
  return termsStale;
}

export function onTermsStale(): void {
  termsStale = true;
  if (redirecting || window.location.pathname === "/terms") return;
  redirecting = true;
  window.location.assign("/terms");
}
