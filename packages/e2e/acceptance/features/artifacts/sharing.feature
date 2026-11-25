@todo
Feature: Sharing an artifact
  An owner shares an artifact through its share link: a private artifact has none, a restricted one opens to the people the owner names, a public one to anyone holding it.
  A folder has a public page of its own.

  Rule: A private artifact has no share link
  Rule: A public artifact's share link opens for anyone who holds it, without signing in
  Rule: A restricted artifact's share link opens only for its owner and the people the owner names
  Rule: Only the owner makes a restricted artifact public; an agent only adds and removes its viewers
  Rule: A folder's public page lists only the public artifacts in it
