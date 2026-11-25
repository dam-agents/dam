Feature: The Terms of Use
  A person accepts the Terms of Use before the platform does anything for them.
  Until then, it offers them the Terms to read and accept, and nothing else.

  Rule: A person who has not accepted the Terms of Use is asked to accept them before anything else

    @ui
    Example: Kim is asked to accept the Terms on signing in
      Given Kim has not accepted the Terms of Use
      When Kim signs in
      Then Kim is asked to accept the Terms of Use before anything else

  Rule: A person can read the Terms of Use before accepting them

    @ui
    Example: Kim reads the Terms before accepting them
      Given Kim has not accepted the Terms of Use
      When Kim reads the Terms of Use
      Then Kim sees the current Terms of Use
