// TEST_OVERVIEW: the sign-in page shows one meaning of the product name at a time.
// TEST_OVERVIEW: The install sets the meanings as a JSON list of strings; the page picks the next one at random and never shows the same one twice in a row.
import { describe, expect, test } from "vitest";

import {
  parseNameMeanings,
  pickNextMeaning,
} from "../login/lib/name-meanings.js";

const first = () => 0;
const last = () => 0.999999;

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

describe("pickNextMeaning", () => {
  const meanings = ["A", "B", "C"];

  test("picks any meaning at random for the first one", () => {
    expect(pickNextMeaning(meanings, undefined, first)).toBe("A");
    expect(pickNextMeaning(meanings, undefined, last)).toBe("C");
  });

  test("never picks the meaning on screen now", () => {
    expect(pickNextMeaning(meanings, "A", first)).toBe("B");
    expect(pickNextMeaning(meanings, "C", last)).toBe("B");
    for (let i = 0; i < 100; i++)
      expect(pickNextMeaning(meanings, "B")).not.toBe("B");
  });

  test("keeps the only meaning when the list has one", () => {
    expect(pickNextMeaning(["A"], "A")).toBe("A");
  });

  test("gives no meaning when the list is empty", () => {
    expect(pickNextMeaning([], undefined)).toBeUndefined();
  });
});
