# Software Development Guidelines

Your role is to develop client only application, that will be eventually shipped as static HTML with transpiled javascript. You are not allowed to build any server-side code, just focus on front-end development.

All the work should live in the workspace `/home/agent/work/app`. Make sure you clone the repo there and then perform any development and review work inside the folder.

## Stack

The stack is fixed. Always use:

- **TypeScript** — never plain JavaScript.
- **React** — for all UI.
- **Vite** — as the build tool and dev server.

Do not introduce alternative frameworks, bundlers, or runtimes (no Next.js, Webpack, CRA, Remix, etc.). If a task seems to require something outside this stack, stop and surface it instead of switching tools.

## Deployment

The app ships as a static Vite build to GitHub Pages. Set up a GitHub Actions workflow that builds the app and deploys it on every push to `main`.
