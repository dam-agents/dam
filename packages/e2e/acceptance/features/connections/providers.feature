Feature: An agent's model providers
  An agent reaches models through the provider connections its owner grants it.

  Rule: A new agent gets a model provider its owner holds

    Example: helper gets Ada's OpenAI provider
      Given Ada has a model provider connected
      When Ada makes an agent called "helper"
      Then "helper" holds Ada's OpenAI provider

  Rule: An agent holds at most one provider connection per provider

    Example: helper cannot take a second OpenAI connection
      Given Ada has a running agent called "helper"
      And Ada has a second OpenAI connection called "openai-team"
      When Ada grants "openai-team" to "helper"
      Then Ada is told the agent already has an OpenAI provider
