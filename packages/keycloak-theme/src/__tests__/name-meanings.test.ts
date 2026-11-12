// TEST_OVERVIEW: the sign-in page's heading spells out what the product name stands for.
// TEST_OVERVIEW: The install sets the meanings as a JSON list of strings. The page starts on the first one, rolls through a few others picked at random, then comes back to the first one and stays there. Each meaning is drawn on three lines, a new line at each capitalized word.
import { describe, expect, test } from "vitest";

import {
  MEANING_PICKS,
  parseNameMeanings,
  planMeaningSequence,
  splitMeaningLines,
} from "../login/lib/name-meanings.js";

const first = () => 0;

describe("parseNameMeanings", () => {
  test("reads a JSON list of strings", () => {
    expect(
      parseNameMeanings('["Debugging At Midnight", "Did Anyone Merge?"]'),
    ).toEqual(["Debugging At Midnight", "Did Anyone Merge?"]);
  });

  // TEST_SCENARIO: an install with no list sets an empty list or nothing at all; the page then shows no meaning.
  test("gives no meanings for an empty list, an empty value or broken JSON", () => {
    expect(parseNameMeanings("[]")).toEqual([]);
    expect(parseNameMeanings("")).toEqual([]);
    expect(parseNameMeanings("not json")).toEqual([]);
    expect(parseNameMeanings('{"a": "b"}')).toEqual([]);
  });

  // TEST_SCENARIO: a duplicate would let the same meaning show twice in a row, and a blank entry would show an empty line.
  test("drops blanks, non-strings and duplicates", () => {
    expect(parseNameMeanings('[" A ", "", "  ", 3, null, "A", "B"]')).toEqual([
      "A",
      "B",
    ]);
  });
});

describe("planMeaningSequence", () => {
  const meanings = ["Anchor", "B", "C", "D", "E", "F"];

  // TEST_SCENARIO: the page must come to rest on the install's main meaning, so the sequence starts and ends on the first one in the list.
  test("starts and ends on the first meaning, with a few picks between", () => {
    const sequence = planMeaningSequence(meanings);
    expect(sequence).toHaveLength(MEANING_PICKS + 2);
    expect(sequence[0]).toBe("Anchor");
    expect(sequence[sequence.length - 1]).toBe("Anchor");
  });

  // TEST_SCENARIO: the picks between differ on each visit, but a visitor never sees one twice or sees the first meaning in the middle.
  test("picks distinct meanings other than the first one", () => {
    for (let i = 0; i < 50; i++) {
      const picks = planMeaningSequence(meanings).slice(1, -1);
      expect(new Set(picks).size).toBe(MEANING_PICKS);
      expect(picks).not.toContain("Anchor");
    }
  });

  test("takes every other meaning when the list holds fewer than the picks", () => {
    expect(planMeaningSequence(["Anchor", "B", "C"], first)).toEqual([
      "Anchor",
      "C",
      "B",
      "Anchor",
    ]);
  });

  test("keeps the only meaning when the list has one", () => {
    expect(planMeaningSequence(["Anchor"])).toEqual(["Anchor"]);
  });

  test("gives no meaning when the list is empty", () => {
    expect(planMeaningSequence([])).toEqual([]);
  });
});

describe("splitMeaningLines", () => {
  test("puts each capitalized word on its own line", () => {
    expect(splitMeaningLines("Deploy Agents Massively")).toEqual([
      "Deploy",
      "Agents",
      "Massively",
    ]);
  });

  // TEST_SCENARIO: the heading is three lines tall, so a meaning with more capitalized words keeps the rest on the last line.
  test("keeps the words after the third line on the last line", () => {
    expect(splitMeaningLines("Drive Agents, Make Coffee")).toEqual([
      "Drive",
      "Agents,",
      "Make Coffee",
    ]);
  });

  test("keeps a lower-case word on the line before it", () => {
    expect(splitMeaningLines("Digital Army of Minions")).toEqual([
      "Digital",
      "Army of",
      "Minions",
    ]);
  });

  test("starts a line even when the meaning opens in lower case", () => {
    expect(splitMeaningLines("  dam it ")).toEqual(["dam it"]);
  });
});
