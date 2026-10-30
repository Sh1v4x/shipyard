---
name: React front
projects: [all]
---

## useEffect only for external synchronisation
Data loading goes through a query hook, actions through mutations with their effects in `onSuccess` / `onError`, polling through `refetchInterval`, derived state is computed during render. `useEffect` is kept for genuine external synchronisation (event listener, imperative library), returns a cleanup, and says why in one line.

## Data access through dedicated hooks
Components never call `fetch` or the API client directly: one hook per read, one hook per write, cache keys in one place. A mutation invalidates only what it changes.

## Query hygiene
Set `enabled` when a query depends on a value that may be missing. Debounce search inputs. Keep loading and error states distinct: an error never shows an endless spinner or an empty state.

## Complex state
From three interacting `useState`, or state shared between components, use a reducer or a store whose actions hold the transition logic.

## No namespaced `React.*`
Named imports (`import { useState } from 'react'`), no `React.FC`.
