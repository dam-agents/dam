Feature: Sharing a knowledge base
  An owner shares a knowledge base as a read-only snapshot of its share roots.
  Whoever holds its share string reads it; the owner changes or withdraws the string.
  The web app offers no sharing since #4572, so these Rules hold the API to the few promises a share string makes.

  Rule: A shared knowledge base serves what its share roots hold, and nothing else

    Example: A page outside the share roots stays private
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And "handbook" holds "notes/salary.md" saying "Ada earns 100"
      And Ada has shared "handbook"
      When Jo lists the pages of "handbook" with Ada's share string
      Then Jo finds the page "wiki/index.md"
      And Jo does not find the page "notes/salary.md"

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

    Example: Ada shares the handbook again under a new share string
      Given Ada has a knowledge base called "handbook" that shares its folder "wiki"
      And "handbook" holds "wiki/index.md" saying "The magic word is plum"
      And Ada has shared "handbook"
      And Ben holds Ada's share string for "handbook"
      And Ada has unshared "handbook"
      When Ada shares "handbook"
      Then the share string Ben holds for "handbook" no longer opens it
      And Ada's current share string for "handbook" opens it
