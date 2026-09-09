/**
 * A missing build asset must come back as a miss, not as the app.
 *
 * `_redirects` ends with `/* /index.html 200` so the client router can match any route. That is
 * right for routes and wrong for `/assets/*`, because `_headers` marks that prefix
 * `immutable, max-age=31536000`. A request for a hashed chunk that is not deployed yet therefore
 * got index.html, with a 200 and a year-long cache header, and the browser stored HTML under a
 * JavaScript URL until 2027: every later load fails with "Expected a JavaScript-or-Wasm module
 * script but the server responded with a MIME type of text/html", and no redeploy fixes it, because
 * the browser never asks again.
 *
 * The window that causes it is ordinary rather than exotic: any visitor who loads the site after a
 * new index.html is live but before its chunks have finished propagating.
 *
 * Pages `_redirects` cannot express this. It supports redirect codes and the 200 rewrite, so a
 * `404` line there is ignored and falls through to the catch-all. A function is the way to say it.
 */
export const onRequestGet = async ({ next }: { next: () => Promise<Response> }) => {
  const response = await next();
  const type = response.headers.get("content-type") ?? "";
  // Nothing under /assets/ is a document. HTML here means the single-page fallback answered, which
  // only happens when the file is not there.
  if (!type.includes("text/html")) return response;
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};
