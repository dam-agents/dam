const ADJECTIVES = [
  "swift",
  "calm",
  "brave",
  "clever",
  "bright",
  "gentle",
  "bold",
  "quiet",
  "lucky",
  "sunny",
  "cosmic",
  "amber",
  "misty",
  "nimble",
  "mellow",
  "stellar",
  "crimson",
  "golden",
  "silent",
  "breezy",
  "frosty",
  "jolly",
  "rustic",
  "velvet",
] as const;

const NOUNS = [
  "otter",
  "falcon",
  "river",
  "panda",
  "maple",
  "comet",
  "willow",
  "sparrow",
  "cedar",
  "harbor",
  "meadow",
  "badger",
  "lynx",
  "heron",
  "ember",
  "pebble",
  "glacier",
  "fern",
  "robin",
  "canyon",
  "lantern",
  "beacon",
  "grove",
  "summit",
] as const;

const pick = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)]!;

export function generateSandboxName(): string {
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}`;
}
