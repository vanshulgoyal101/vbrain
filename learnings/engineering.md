# Engineering learnings

> **TL;DR** — Frontend/state/testing bug classes that keep recurring, and the
> fixes that stuck. Written so future-me stops re-learning them. (Demo content.)

## State & lifecycle

- **Never clear local data on sign-out.** In [PixelPaws](../projects/pixelpaws.md)
  the daily streak lived only in the local blob; the cloud copy stored a high
  score, not the streak. Wiping local state on logout deleted the streak for good.
  Sign-out should end the session and *keep* local data.
- **Cancel before you start.** A render loop started without cancelling the
  previous `requestAnimationFrame` runs twice as fast on replay. Cancel at the top
  of `start()`.
- **Guard double-submit synchronously.** Set the "busy" flag before any `await`,
  not after — otherwise a fast second click slips through.

## Caching & PWAs

- **Bump the asset version** when you edit a non-hashed file, or the service
  worker keeps serving the old one.
- **Network-first for documents, cache-first for hashed assets.** Mixing them up
  is why "my change didn't deploy" is usually a cache, not a build.

## Testing

- Test the **pure logic**, not the DOM. If logic is hard to test, it's too coupled
  to the view — split it. See [learnings/README.md](README.md).
