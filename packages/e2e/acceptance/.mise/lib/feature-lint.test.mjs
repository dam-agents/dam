import assert from "node:assert/strict";
import { test } from "node:test";

import { lintFeature, placement } from "./feature-lint.mjs";

const example = (source) => lintFeature(source, false, new Map(), "x.feature");
const journey = (source) => lintFeature(source, true, new Map(), "j.feature");

const everyKind = `# language: en
# a comment line
@ui
Feature: An owner's agents
  A description line of the feature.

  Background:
    Given Ada has a model provider connected

  Rule: An agent answers its owner's message in the chat
    A description line of the rule.

    Background:
      Given Ada has a running agent called "helper"

    @wip
    Example: Ada gets an answer
      Given Ada has a running agent called "notes" that answers "Hi"
      And Ada has a running agent called "drafts"
      But Ada has no other agents
      When Ada sends "hello" to "helper"
      Then Ada sees "helper" answer "Hi"
      And Ada sees an agent called "notes"
      But Ada does not see an agent called "spam"

    Scenario Outline: Ada names an agent <name>
      Given Ada has a running agent called "<name>"
      When Ada looks at the agents
      Then Ada sees an agent called "<name>"

      @api
      Examples:
        | name   |
        | first  |
        | second |

    Example: Ada keeps a long note
      Given Ada has a running agent called "notes"
      When Ada sends the note to "notes"
        """
        a doc string, where a click or a button is data
        """
      Then Ada sees "notes" answer
        | column |
        | a cell with a menu in it |
`;

test("a feature that uses every Gherkin line kind within the rules passes", () => {
  assert.deepEqual(example(everyKind), []);
});

test("a Rule with no examples yet passes when it, or its Feature, names the issue that will write them", () => {
  assert.deepEqual(
    example(`Feature: f
  Rule: r
    Example: e
      Given a
      When b
      Then c

  @todo-6810
  Rule: s
`),
    [],
  );
  assert.deepEqual(
    example(`@todo-6810
Feature: f
  A description of the capability.

  Rule: r
  Rule: s
`),
    [],
  );
});

test("a feature file sits in one area folder", () => {
  assert.equal(placement(["agents", "editors.feature"]), null);
  assert.notEqual(placement(["editors.feature"]), null);
  assert.notEqual(placement(["agents", "sharing", "editors.feature"]), null);
});

const broken = {
  "a Rule with examples that is still @todo": `Feature: f
  @todo-12
  Rule: r
    Example: e
      Given a
      When b
      Then c
`,
  "a @todo Feature with a Rule that has examples": `@todo-12
Feature: f
  Rule: r
    Example: e
      Given a
      When b
      Then c
`,
  "a @todo tag that names no issue": `Feature: f
  @todo
  Rule: r
`,
  "a @todo tag that names no real issue number": `Feature: f
  @todo-0
  Rule: r
`,
  "an example outside a Rule": `Feature: f
  Example: e
    Given a
    When b
    Then c
`,
  "two When steps": `Feature: f
  Rule: r
    Example: e
      Given a
      When b
      When c
      Then d
`,
  "an And continuing the When": `Feature: f
  Rule: r
    Example: e
      Given a
      When b
      And c
      Then d
`,
  "no When": `Feature: f
  Rule: r
    Example: e
      Given a
      Then d
`,
  "a Given after a When": `Feature: f
  Rule: r
    Example: e
      When b
      Given a
      Then d
`,
  "a When after a Then": `Feature: f
  Rule: r
    Example: e
      Given a
      Then d
      When b
`,
  "no Then": `Feature: f
  Rule: r
    Example: e
      Given a
      When b
`,
  "too many steps": `Feature: f
  Rule: r
    Example: e
      Given a
      And a
      And a
      And a
      And a
      And a
      And a
      When b
      Then c
`,
  "an unknown tag": `Feature: f
  Rule: r
    @smoke
    Example: e
      Given a
      When b
      Then c
`,
  "an unknown tag on an Examples table": `Feature: f
  Rule: r
    Scenario Outline: e <x>
      Given a <x>
      When b
      Then c
      @nightly
      Examples:
        | x |
        | 1 |
`,
  "@journey outside the journeys folder": `@journey
Feature: f
  Rule: r
    Example: e
      Given a
      When b
      Then c
`,
  "a screen word in a step": `Feature: f
  Rule: r
    Example: e
      Given a
      When Ada clicks the send button
      Then c
`,
  "a screen word in an example name": `Feature: f
  Rule: r
    Example: the dialog closes
      Given a
      When b
      Then c
`,
  "a screen word in a rule": `Feature: f
  Rule: the sidebar lists agents
    Example: e
      Given a
      When b
      Then c
`,
  "a nameless example": `Feature: f
  Rule: r
    Example:
      Given a
      When b
      Then c
`,
  "a Rule without examples": `Feature: f
  Rule: r
`,
  "a nameless Feature": `Feature:
  Rule: r
    Example: e
      Given a
      When b
      Then c
`,
  "text that does not parse": `Feature: f
  Rule: r
    Example: e
      Given a
    | a table with no step before it is fine, but this line is not |
  Nonsense
`,
};

for (const [what, source] of Object.entries(broken))
  test(`an example with ${what} is refused`, () => {
    assert.notDeepEqual(example(source), [], what);
  });

test("two examples with one name are refused, across files", () => {
  const names = new Map();
  const one = `Feature: f
  Rule: r
    Example: same
      Given a
      When b
      Then c
`;
  assert.deepEqual(lintFeature(one, false, names, "a.feature"), []);
  assert.notDeepEqual(lintFeature(one, false, names, "b.feature"), []);
});

const goodJourney = `@journey @ui
Feature: First use
  Scenario: Jo meets a first agent
    Given Jo has a model provider connected
    When Jo signs in
    Then Jo sees an agent called "first"
    When Jo sends "hello" to "first"
    Then Jo sees "first" answer
`;

test("a journey may alternate When and Then", () => {
  assert.deepEqual(journey(goodJourney), []);
});

const brokenJourneys = {
  "a @todo tag": `@journey @ui @todo-12
Feature: j
  Scenario: s
    Given a
    When b
    Then c
`,
  "no surface tag": goodJourney.replace(" @ui", ""),
  "no @journey tag": goodJourney.replace("@journey ", ""),
  "a Given after a When": goodJourney.replace(
    '    Then Jo sees "first" answer\n',
    '    Then Jo sees "first" answer\n    Given Jo has a model provider connected\n',
  ),
  "a Rule": `@journey @ui
Feature: f
  Rule: r
    Scenario: s
      Given a
      When b
      Then c
`,
  "a screen word": goodJourney.replace("Jo signs in", "Jo clicks sign in"),
  "no Then": `@journey @ui
Feature: f
  Scenario: s
    Given a
    When b
`,
};

for (const [what, source] of Object.entries(brokenJourneys))
  test(`a journey with ${what} is refused`, () => {
    assert.notDeepEqual(journey(source), [], what);
  });
