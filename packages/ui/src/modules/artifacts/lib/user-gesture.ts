interface ActivationReporter {
  userActivation?: { isActive: boolean };
}

// UNIT_BOUNDARY_DESCRIPTION: A person's click and the page's own timer arrive on the same `artifact.request` message, and the page is not allowed to say which it was. Only the browser knows: a gesture inside the frame gives every window above it transient activation, a timer gives none. That read is the whole basis for `trigger`, so it lives here alone and takes the navigator as an argument to stay testable. A browser that does not report activation is read as a person asking, because refusing a real click is worse than letting a timer through, and the server's caps still bound what a timer can spend.
export function askedByAPerson(navigator: ActivationReporter): boolean {
  return navigator.userActivation?.isActive ?? true;
}
