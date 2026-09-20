/**
 * A locally stored file is served by the service worker or not at all.
 *
 * Everything under this prefix lives in this browser's own cache, put there by `lib/webStore.ts`
 * and answered by `public/sw.js`. Nothing under it exists on any server, so a request that reaches
 * one means the worker is not controlling the page: unregistered, cleared, or a browser that
 * refuses them.
 *
 * Without this it would be answered by the `/* /index.html 200` rule in `_redirects`, so a missing
 * sound would come back as the app itself with a 200, and the player would try to decode HTML. A
 * cue that is silent because the file is not here is the same outcome either way; the difference is
 * that this one says so in the network panel instead of looking like a decoder bug.
 */
export const onRequestGet = async () =>
  new Response("This file is stored in the browser, not on the server.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
