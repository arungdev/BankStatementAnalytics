# Reusable client framework

`@common/client` owns generic UI, theme, cookie authentication, HTTP setup,
safe browser storage, validated preferences, error presentation and async request
lifecycles. Banking pages, API routes, permissions, account context, financial
formatting and application workflows remain in `Client/src` and compose these
primitives. Moving domain workflows into the framework would couple every consumer
to this application.

## Install and integrate

From the separate `Common.Client` source checkout:

```sh
npm ci
npm run build
npm test
npm pack
```

Install the resulting archive in any React 19 project alongside peer dependencies:

```sh
npm install ./common-client-0.1.0.tgz react react-dom axios react-icons
```

The package retains its existing noncommercial license; reuse must comply with it.
For this repository, run `npm run release` inside `Common.Client` to rebuild and
vendor the artifacts. Never edit generated `Client/vendor/common-client/dist`.
The source is a separate, gitignored repository: review and retain its changes
there as well as the application changes here. Fresh application clones only need
`npm ci` inside `Client`; no private source checkout is required.

```jsx
import { createApiClient } from '@common/client/core';
import { AuthProvider, ThemeProvider, Button, useAsyncResource } from '@common/client';
import '@common/client/styles.css'; // before application overrides

const api = createApiClient({
  baseURL: '/service',
  publicPaths: ['/sign-in', '/register'],
  loginPath: '/sign-in',
  timeout: 15000,
});
// Wrap the application in ThemeProvider and AuthProvider api={api}.
// AuthProvider defaults to /auth/{status,login,setup,register,logout};
// configure basePath and adminRole for compatible cookie-auth services.
// Other authentication protocols can provide their own provider.
```

## Public API additions

| Export | Contract |
| --- | --- |
| `createApiClient(options)` | Axios-compatible instance. Existing defaults preserved. Accepts Axios request defaults, injected `transport.create`, `resolveLocation`, and `onUnauthorized(error)` to override redirects. No browser location means no redirect. |
| `createSafeStorage(resolveStorage)` | Lazy `getItem`, `setItem`, `removeItem` adapter; unavailable storage becomes a no-op. |
| `browserStorage` | Safe lazy localStorage adapter. |
| `readStoredStringSet(key, storage?)` | Decode strings only; malformed data becomes an empty Set. |
| `writeStoredStringSet(key, values, limit?, storage?)` | Persist strings, optionally retaining the last `limit` entries. |
| `preferenceKey(namespace, user, scope, page, field)` | Encoded namespace and identity-scoped key. Each project should supply a unique namespace. |
| `readViewPreference(storage, key, fallback, validate?, legacyKey?)` | Restore validated JSON or return fallback; optional legacy migration read. |
| `writeViewPreference(storage, key, value)` | Best-effort JSON write. |
| `oneOf(...values)`, `preferenceValidators` | Reusable validators for choices, page size, amount, width and page number. Applications can supply any `(value) => boolean` validator. |
| `apiErrorMessage(error, fallback?)` | String response, ProblemDetails or validation message with network/timeout fallback; rejects HTML string response bodies. |
| `startGuardedRequest(load, onSuccess, onError)` | Calls `load(signal)` asynchronously; returned cleanup aborts and suppresses stale callbacks. |
| `useAsyncResource(load, initialData)` | Memoize `load` with useCallback. Returns `data`, `loading`, `hasLoaded`, `error`, `retry`, `updateData`; guards stale loads on replacement/unmount. |
| `usePreference(key, initialValue, options?)` | Validated persisted state with injected `storage`, `validate`, and `legacyKey`. Restores synchronously when key or storage changes and ignores stale setters. |
| `RequestError({error,onRetry})` | Generic retry alert, hidden when error is absent. |
| `ConfirmDialog(props)` | Modal with open, title, message, labels, danger, busy, onConfirm and onCancel. |
| `Pagination(props)` | currentPage, totalPages, itemsPerPage, currentCount, totalCount, startIndex, itemLabel, callbacks and loading. Generic label defaults to items. |

Utilities and HTTP are available from `@common/client/core` without loading React,
icons or CSS. UI and hooks are available from the package root. React, icons and
Axios remain external peers to avoid duplicate runtimes. No additional runtime
dependencies were added. Existing theme, auth and UI exports are unchanged.

```js
import { createSafeStorage, preferenceKey, readViewPreference } from '@common/client/core';
const storage = createSafeStorage(() => sessionStorage);
const key = preferenceKey('inventory-v1', 'alice', 'warehouse-2', 'stock', 'sort');
const sort = readViewPreference(storage, key, 'name', value => ['name', 'count'].includes(value));
```

## Compatibility and validation

Original application module paths re-export the shared implementations. The
application keeps `bsa-view-v1` keys, custom financial defaults and transaction
pagination labels, preserving stored settings and call signatures. No endpoint,
route, domain model or existing in-progress feature was migrated into the package.

Run `npm run build && npm test` in Common.Client to test its built public entry
points, injected API transport, independent project namespaces, SSR UI rendering,
storage failure and cancellation behavior. Run `npm test` and `npm run build` in
Client for application regressions and production integration. Browser interaction
and backend integration checks are still required before a production deployment.
