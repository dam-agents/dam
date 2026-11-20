Feature: Signing in
  A person signs in to the platform through its identity provider, in the web UI and in the CLI.

  Rule: A link a person follows while signed out opens once they have signed in

    @ui
    Example: Ada's Slack bind link opens after Ada signs in
      When Ada follows a Slack bind link while signed out
      Then Ada lands on that Slack bind link

  Rule: A person signs the CLI in by allowing its sign-in in the browser

    Example: Ada allows the CLI's sign-in
      When Ada signs the CLI in and allows it in the browser
      Then the CLI is signed in as Ada

  Rule: A person who refuses the CLI's sign-in in the browser leaves the CLI signed out

    Example: Ada refuses the CLI's sign-in
      When Ada signs the CLI in and refuses it in the browser
      Then the CLI of Ada is not signed in
