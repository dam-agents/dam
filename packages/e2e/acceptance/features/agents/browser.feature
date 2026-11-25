Feature: An agent's browser
  An owner sees and uses the one browser inside an agent's machine, beside the chat.
  The owner and the agent share its tabs and the tab in front.

  Rule: The browser is offered only on an agent that requires naming its connections

    @ui
    Example: An agent that does not require naming offers no browser
      Given Jo has a running agent called "helper" that does not require naming its connections
      When Jo opens the browser of "helper"
      Then Jo is not offered the browser of "helper"

  Rule: A fresh browser has one tab, for the owner and the agent alike

    @ui
    Example: Ada sees one tab in helper's fresh browser
      Given Ada has a running agent called "helper"
      And the browser of "helper" is fresh
      When Ada opens the browser of "helper"
      Then Ada sees the browser of "helper" with 1 tab

  Rule: A tab the agent opens comes to the front for the owner

    Example: helper opens Alpha in front of Ada
      Given Ada has a running agent called "helper" that opens a page titled "Alpha"
      And the browser of "helper" is fresh
      And Ada has the browser of "helper" open
      When Ada sends "open Alpha" to "helper"
      Then Ada sees "Alpha" in front in the browser of "helper"
      And Ada sees the browser of "helper" with 2 tabs

  Rule: The tab the owner brings to the front is the one the agent acts on

    @ui
    Example: helper reads the page Ada brought to the front
      Given Ada has a running agent called "helper" that answers with the title of its page
      And the browser of "helper" has the tabs "Alpha, Beta", with "Beta" in front
      And Ada has brought "Alpha" to the front of the browser of "helper"
      When Ada sends "which page?" to "helper"
      Then Ada sees "helper" answer "Alpha"

  Rule: A new tab the owner opens is blank and in front

    @ui
    Example: Ada opens a blank tab in helper's browser
      Given Ada has a running agent called "helper"
      And the browser of "helper" is fresh
      And Ada has the browser of "helper" open
      When Ada opens a new tab in the browser of "helper"
      Then Ada sees a blank tab in front in the browser of "helper"
      And Ada sees the browser of "helper" with 2 tabs

  Rule: Closing the tab in front brings the tab after it to the front, else the one before

    @ui
    Example: Closing Beta brings Gamma to the front
      Given Ada has a running agent called "helper"
      And the browser of "helper" has the tabs "Alpha, Beta, Gamma", with "Beta" in front
      And Ada has the browser of "helper" open
      When Ada closes the tab "Beta" in the browser of "helper"
      Then Ada sees "Gamma" in front in the browser of "helper"
      And Ada does not see the tab "Beta" in the browser of "helper"

    @ui
    Example: Closing the last tab brings the one before it to the front
      Given Ada has a running agent called "helper"
      And the browser of "helper" has the tabs "Alpha, Beta", with "Beta" in front
      And Ada has the browser of "helper" open
      When Ada closes the tab "Beta" in the browser of "helper"
      Then Ada sees "Alpha" in front in the browser of "helper"
      And Ada does not see the tab "Beta" in the browser of "helper"

    Example: Closing the only tab leaves a blank one
      Given Ada has a running agent called "helper"
      And the browser of "helper" is fresh
      And Ada has the browser of "helper" open
      When Ada closes the tab in front in the browser of "helper"
      Then Ada sees a blank tab in front in the browser of "helper"
      And Ada sees the browser of "helper" with 1 tab

  Rule: The owner is shown the browser's tabs as they are now

    Example: Ada finds the tab helper opened while Ada was away
      Given Ada has a running agent called "helper" that opens a page titled "Gamma"
      And the browser of "helper" is fresh
      And Ada has sent "open Gamma" to "helper"
      When Ada opens the browser of "helper"
      Then Ada sees "Gamma" in front in the browser of "helper"

  Rule: Only http and https addresses open

    Example: Ada cannot open a file in helper's browser
      Given Ada has a running agent called "helper"
      And Ada has the browser of "helper" open
      When Ada goes to "file:///etc/hosts" in the browser of "helper"
      Then Ada is told only http and https addresses open

  Rule: An action on a tab that has closed is refused

    Example: Ada cannot bring back a tab that has closed
      Given Ada has a running agent called "helper"
      And the browser of "helper" has the tabs "Alpha, Beta", with "Beta" in front
      And the tab "Alpha" of the browser of "helper" has since closed
      When Ada brings "Alpha" to the front of the browser of "helper"
      Then Ada is told the tab is closed
