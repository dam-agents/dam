/* UNIT_BOUNDARY_DESCRIPTION: The login page's deployment-specific content: the
 * docs link, the community link and the testimonials. The sections read it from
 * one LoginContent value that Login.tsx passes down, so where the values come
 * from can change without touching a section. An empty docsUrl, a missing
 * community or an empty testimonials list hides that part of the page. A quote
 * may name the product as {brand}; the testimonials section fills in the realm's
 * display name. */

export type Testimonial = {
  name: string;
  role: string;
  quote: string;
  initials: string;
  color: string;
};

export type CommunityLink = { label: string; url: string };

export type LoginContent = {
  docsUrl: string;
  community: CommunityLink | undefined;
  testimonials: Testimonial[];
};

export const DEFAULT_LOGIN_CONTENT: LoginContent = {
  docsUrl: "https://ibm.biz/dam-docs",
  community: {
    label: "#dam-community",
    url: "https://ibm.enterprise.slack.com/archives/C07PDAWV0QG",
  },
  testimonials: [
    {
      name: "Edgar Bruney Castañeda",
      role: "Software Developer, Technology CPQ - SOVA",
      quote:
        "I have it integrated with Jira and GitHub, and I’ve given it context regarding everything my team does. It saves me a lot of time on routine tasks. It’s incredibly easy to work with.",
      initials: "EC",
      color: "#4589ff",
    },
    {
      name: "Ashley Evans",
      role: "Research Software Engineer",
      quote:
        "We use {brand} across our whole software development lifecycle, from planning, drafting GitHub issues, writing and reviewing code, to analysing production logs, monitoring OpenShift cluster health and keeping watch over our system architecture, and its Slack integration has turned it from a UI tool into a shared workspace where 16 team members work with {brand} and each other in one channel.",
      initials: "AE",
      color: "#42be65",
    },
    {
      name: "Alexander Merschel",
      role: "AI Leader, IBM z Software",
      quote:
        "The Slack integration and the general setup is a gamechanger in how we work together.",
      initials: "AM",
      color: "#a56eff",
    },
    {
      name: "Mudhakar Srivatsa",
      role: "Distinguished Engineer, AI Platform",
      quote: "Immensely useful to have this agent on Spyre Slack channels.",
      initials: "MS",
      color: "#ee5396",
    },
    {
      name: "Tom Morris",
      role: "Infrastructure & Operations Lead, AI Platform Enablement",
      quote:
        "{brand} is doing a fleet sweep for me for several of my clusters every morning, and I use it to bridge Slack requests to GitHub.",
      initials: "TM",
      color: "#0f62fe",
    },
  ],
};

export function withBrand(quote: string, brand: string): string {
  return quote.split("{brand}").join(brand);
}
