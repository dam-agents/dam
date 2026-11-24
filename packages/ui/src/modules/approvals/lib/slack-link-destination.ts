const SHORT_ADDRESS_LENGTH = 40;

const bareAddress = (value: string): string =>
  value
    .trim()
    .replace(/^mailto:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");

function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

// UNIT_BOUNDARY_DESCRIPTION: what a link in a held Slack message shows next to its label, so the person who answers sees where the link really goes without a hover. A label can be any text, even another address, so a label that is not the link's own address gets the real address next to it: the whole address when it is short, else its host. Null when the label is the address itself, give or take the scheme and a last slash.
export function slackLinkDestination(
  url: string,
  label: string,
): string | null {
  const address = url.replace(/^mailto:/i, "");
  if (bareAddress(label) === bareAddress(url)) return null;
  if (address.length <= SHORT_ADDRESS_LENGTH) return address;
  return hostOf(url) ?? address;
}
