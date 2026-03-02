# Fallback CLI (embedded)

**Isolated fallback UI** shown when the main app hits a rendering error. Do not depend on or import from the main UI (e.g. `../pages/*`, `../App`). Only use:

- `../../client/trpc` for API
- `@mantine/core` for minimal layout
- React

This keeps the fallback stable when the rest of the frontend is broken. It continues the latest session and supports CLI-like commands.
