Feature: Open views follow changes
  What an owner has open follows the changes made anywhere else, without a reload.

  Rule: An owner's open view shows an agent made or deleted elsewhere, without a reload

    @ui
    Example: Ada sees scratch appear
      Given Ada is looking at the agents
      When Ada makes an agent called "scratch" through the API
      Then Ada sees "scratch" appear without a reload

    @ui
    Example: Ada sees scratch disappear
      Given Ada has an agent called "scratch"
      And Ada is looking at the agents
      When Ada deletes "scratch" through the API
      Then Ada sees "scratch" disappear without a reload
