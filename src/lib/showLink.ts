import { useEffect, useRef, useState } from "react";
import type { ShowMsg } from "./shows";
import { openShowLink, type Router, type Transport } from "./transport";
import { cloudTransport } from "./transports/cloud";

/**
 * The transports a show will try, in order of preference. Local wires get prepended here as they
 * land; cloud is last because it is the only one that needs the venue to have working internet.
 */
export const showTransports: Transport[] = [cloudTransport];

/**
 * A message sent before the link is up is not dropped, it waits. This is the whole reason the crew
 * used to hang on "Waiting for the host to send the deck": `Show.tsx` sent its `here` the instant
 * `showChannel()` returned, and the socket had not joined yet, so nobody ever heard it.
 *
 * Bounded, because if the link never comes up a growing queue helps nobody -- and the oldest message
 * is the one worth losing, since a cue from a minute ago is of no use to the room now.
 */
export const QUEUE_LIMIT = 64;

/** Reconnect backoff, in ms. Caps rather than growing without limit, because shows are long. */
export const backoffFor = (attempt: number) => Math.min(1_000 * 2 ** attempt, 15_000);

export type ShowLink = {
  send: (msg: ShowMsg) => void;
  /** Which wire is carrying the show, or null while there is none. */
  transport: string | null;
  ready: boolean;
};

export type ShowLinkOptions = {
  show: string;
  transports: Transport[];
  onMessage: (msg: ShowMsg, from: string) => void;
  /**
   * Sent on every connect, not only the first. That is what makes a mid-show reconnect recover: the
   * device asks the host for the deck again rather than sitting on whatever it last saw.
   */
  hello?: () => ShowMsg | null;
  onTransport?: (id: string | null) => void;
  /** Both injectable so tests do not have to wait out a real backoff. `delay` returns a canceller. */
  open?: typeof openShowLink;
  delay?: (fn: () => void, ms: number) => () => void;
};

export type ShowLinkHandle = {
  send: (msg: ShowMsg) => void;
  close: () => void;
  readonly transport: string | null;
  /** Exposed for tests and for the "N messages waiting" state a slow link deserves to show. */
  readonly queued: number;
};

/**
 * Keeps one link to a show open, retrying until it has one.
 *
 * Kept free of React so the part worth testing -- the queue, the greeting, the backoff -- can be
 * tested without a renderer. `useShowLink` below is the thin wrapper components use.
 */
export function createShowLink(options: ShowLinkOptions): ShowLinkHandle {
  const openLink = options.open ?? openShowLink;
  const later = options.delay ?? ((fn: () => void, ms: number) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); });
  let router: Router | null = null;
  let queue: ShowMsg[] = [];
  let closed = false;
  let cancelRetry: (() => void) | null = null;
  let attempt = 0;

  const push = (msg: ShowMsg) => {
    queue.push(msg);
    if (queue.length > QUEUE_LIMIT) queue.shift();
  };

  const flush = (open: Router) => {
    const greeting = options.hello?.();
    if (greeting) { try { open.send(greeting); } catch { push(greeting); } }
    const waiting = queue;
    queue = [];
    for (const msg of waiting) {
      try { open.send(msg); } catch { push(msg); }
    }
  };

  const schedule = () => {
    if (closed || cancelRetry) return;
    cancelRetry = later(() => {
      cancelRetry = null;
      if (closed) return;
      router?.close();
      router = null;
      void connect();
    }, backoffFor(attempt++));
  };

  const connect = async () => {
    try {
      const open = await openLink(options.show, options.transports, options.onMessage, id => {
        if (closed) return;
        options.onTransport?.(id);
        if (!id) { schedule(); return; }
        attempt = 0;
        // On the first connect this fires before `router` is assigned; the block below flushes.
        if (router) flush(router);
      });
      if (closed) { open.close(); return; }
      router = open;
      options.onTransport?.(open.transport);
      if (open.transport) flush(open); else schedule();
    } catch {
      // Every transport refused. Nothing to close, so just try again later.
      if (!closed) schedule();
    }
  };

  void connect();

  return {
    get transport() { return router?.transport ?? null; },
    get queued() { return queue.length; },
    send(msg) {
      if (closed) return;
      const open = router;
      if (!open?.transport) { push(msg); return; }
      try { open.send(msg); } catch { push(msg); }
    },
    close() {
      closed = true;
      cancelRetry?.();
      cancelRetry = null;
      router?.close();
      router = null;
      queue = [];
    },
  };
}

/** Opens a link for as long as the component is mounted, and re-opens it if it drops. */
export function useShowLink(
  showId: string | null | undefined,
  onMessage: (msg: ShowMsg, from: string) => void,
  hello?: () => ShowMsg | null,
): ShowLink {
  const [transport, setTransport] = useState<string | null>(null);
  const handle = useRef<ShowLinkHandle | null>(null);
  // Held in refs so a new callback identity on re-render does not tear the link down mid-show.
  const handler = useRef(onMessage); handler.current = onMessage;
  const greet = useRef(hello); greet.current = hello;

  useEffect(() => {
    if (!showId) { setTransport(null); return; }
    const link = createShowLink({
      show: showId,
      transports: showTransports,
      onMessage: (msg, from) => handler.current(msg, from),
      hello: () => greet.current?.() ?? null,
      onTransport: setTransport,
    });
    handle.current = link;
    return () => { link.close(); handle.current = null; setTransport(null); };
  }, [showId]);

  return {
    transport,
    ready: transport !== null,
    send: (msg: ShowMsg) => handle.current?.send(msg),
  };
}
