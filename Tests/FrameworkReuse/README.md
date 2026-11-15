# Independent framework consumers

Each consumer is a separately installed Node/React project with its own lockfile.
Run `npm ci` and `npm test` inside both `consumer-a` and `consumer-b`.
The `.npmrc` copies the local package rather than symlinking it so React resolves
from the consumer, as it would for a published package.

Alpha uses `/service` and `/sign-in`; beta uses `/v2` and `/session/new`, with
separate preference namespaces. Both exercise root/core package exports, an
injected HTTP adapter, storage, preferences, server-rendered UI and authentication
and theme exports. The adapter makes no external requests. These smoke fixtures
do not validate full browser applications or every shared component.
