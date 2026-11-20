Feature: Sharing a knowledge base
  An owner shares a knowledge base as a read-only snapshot of its share roots.
  Whoever holds its share string reads it; the owner changes or withdraws the string.

  Rule: A shared knowledge base serves what its share roots hold, and nothing else

    Example: Jo reads Ada's handbook with its share string
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      When Jo reads "wiki/index.md" of "handbook" with Ada's share string
      Then Jo reads "The magic word is plum"

    Example: Jo finds a page of the handbook by searching it
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      When Jo searches "handbook" for "plum" with Ada's share string
      Then Jo finds the page "wiki/index.md"

    Example: A page outside the share roots stays private
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And "handbook" holds "notes/salary.md" saying "Ada earns 100"
      And Ada has shared "handbook"
      When Jo lists the pages of "handbook" with Ada's share string
      Then Jo finds the page "wiki/index.md"
      And Jo does not find the page "notes/salary.md"

  Rule: A shared knowledge base answers while its agent sleeps

    Example: Jo reads the handbook while it sleeps
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And "handbook" is asleep
      When Jo reads "wiki/index.md" of "handbook" with Ada's share string
      Then Jo reads "The magic word is plum"

  Rule: A refresh by the owner reaches the readers at once

    Example: Ada's refresh reaches Jo at once
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And "handbook" has since changed "wiki/index.md" to "The magic word is quince"
      When Ada refreshes the share of "handbook"
      Then Jo reads "The magic word is quince" in "wiki/index.md" of "handbook" with Ada's share string within one minute

  Rule: Rotating the share string locks out every holder of the old one

    Example: Ada rotates the handbook's share string
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      When Ada rotates the share string of "handbook"
      Then the share string Ben holds for "handbook" no longer opens it
      And Ada's current share string for "handbook" opens it

  Rule: Unsharing withdraws the share string, and sharing again never revives it

    Example: Ada unshares the handbook
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      When Ada unshares "handbook"
      Then the share string Ben holds for "handbook" no longer opens it

    Example: Ada shares the handbook again under a new share string
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      And Ada has unshared "handbook"
      When Ada shares "handbook"
      Then the share string Ben holds for "handbook" no longer opens it
      And Ada's current share string for "handbook" opens it

  Rule: Another person connects a knowledge base with a current share string only

    Example: Ben connects Ada's handbook
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      When Ben connects the share string Ben holds for "handbook"
      Then Ben has a connection to the knowledge base "handbook"

    Example: Ben cannot connect a share string Ada rotated away
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      And Ada has rotated the share string of "handbook"
      When Ben connects the share string Ben holds for "handbook"
      Then Ben is told the share string is unknown or revoked

  Rule: Only a signed-in person gets a share string, never an API key

    Example: Ada's API key cannot reveal the handbook's share string
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ada has an API key called "admin" that may manage agents
      When Ada asks for the share string of "handbook" with the key "admin"
      Then Ada is refused as not allowed
