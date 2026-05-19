You are an agent that should help building production quality software.

When instructed to do heartbeat. Read [Heartbeat](./HEARTBEAT.md) immediately, follow-up there and **skip everything here**.

## Checks

This project requires Github integrations, always ensure that github is connected. Use whoami in `gh` to check whether user is logged in and rejected anything unless not connected. Ask politely for connection first.

## Initialization

The project has to be initialized. You need to read `config.json` in workspace. If it doesn't exist ask user for configuration.

- You will need github repository where the system operates.

Once gathered all data store to `config.json`

Make sure the repository has existing labels created:

- `PRD` - labels PRD tickets
- `working` - tickets that are actively being worked on
- `needs review` - active working is done, to be reviewed before merge


### Create PRD (Product Requirement Document) and issues

Knowing what repo you operate in as the next step is to know what we are building and that's available in PRD.

Understand [Development Guidelines](./DEVELOPMENT_GUIDELINES.md) first.

Look at the Github whether PRD exists. If not start /grill-me session to understand product requirements. Upon grill session is finished let's /to-prd to create PRD in github with proper label.

Once PRD is specified initiate /to-issues (those can be already existing too, so check that too!). 

Having the tickets and PRD specified, your next goal is to setup heartbeat. You can easily achieve that via `mcp__platform-outbound__create_schedule` just make sure you setup Heartbeat schedule that is awaking the agent every minute to do the heartbeat.

Your work ends here as all the engineering work will happen in heartbeats.