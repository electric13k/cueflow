import { useEffect, useRef, useState } from "react";
import type { ShowMsg } from "./shows";
import { openShowLink, PayloadTooLarge, type Router, type Transport } from "./transport";
import { cloudTransport } from "./transports/cloud";
import { bleTransport } from "./transports/ble";
import { toast } from "./toast";

/**
 * The transports a show will try, in order of preference.
 *
 * Cloud is last because it is the only one that needs the venue to have working internet, and a
 * venue is exactly where that is not true. Bluetooth is ahead of it but is not tried on its own
 * initiative: Web Bluetooth will not scan without the operator picking a device from the browser's
 * chooser, so `bleTransport.available()` reports only that the radio exists. Putting it first means
 * a room that has already been joined over Bluetooth stays on Bluetooth; a room that has not falls
 * through to the cloud in the usual way.
 */
export const showTransports: Transport[] = [bleTransport, cloudTransport];

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
  /** Re-probe the transports now. See `ShowLinkHandle.reopen`. */
  reopen: () => void;
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
  /**
   * A message no link in the room can carry.
   *
   * Requeueing it retried it for ever: it went to the back of the queue on every flush while
   * `QUEUE_LIMIT` shifted real cues off the front, and nobody was ever told the deck had not gone
   * out. A refusal is an answer, so it is reported rather than retried.
   */
  onRefused?: (msg: ShowMsg, error: PayloadTooLarge) => void;
  /** Both injectable so tests do not have to wait out a real backoff. `delay` returns a canceller. */
  open?: typeof openShowLink;
  delay?: (fn: () => void, ms: number) => () => void;
};

export type ShowLinkHandle = {
  send: (msg: ShowMsg) => void;
  close: () => void;
  /**
   * Probe the transports again, now, without waiting out the backoff.
   *
   * The reason this exists is Bluetooth. `bleTransport.available()` answers false until the operator
   * has pressed something, because `requestDevice` puts the browser's own chooser on screen and will
   * not run from a background probe. So the press that turns Bluetooth on has to be able to say "ask
   * again", or the transport it just enabled would not be considered until the next reconnect.
   */
  reopen: () => void;
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

  /**
   * Send it, or decide whether it is worth keeping.
   *
   * A message no link can carry must not go back on the queue. Retrying it forever is worse than
   * dropping it: it is re-sent on every flush, and since `push` appends while the queue evicts from
   * the front, a deck too big for a Bluetooth link quietly shifts the real cues out behind it. The
   * caller is told instead, because "the script is too long to send over Bluetooth" is something the
   * operator can act on and a silently missing cue is not.
   */
  const deliver = (open: Router, msg: ShowMsg) => {
    try { open.send(msg); }
    catch (error) {
      if (error instanceof PayloadTooLarge) { options.onRefused?.(msg, error); return; }
      push(msg);
    }
  };

  const flush = (open: Router) => {
    const greeting = options.hello?.();
    if (greeting) deliver(open, greeting);
    const waiting = queue;
    queue = [];
    for (const msg of waiting) deliver(open, msg);
  };

  /** Drop a retry that is no longer wanted, so it cannot fire against a link that has recovered. */
  const unschedule = () => { cancelRetry?.(); cancelRetry = null; };

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
        // The link failed over and recovered on its own. Without this the retry armed a moment ago
        // still fires, closes a working router and reconnects from scratch, which takes the show off
        // the wire for as long as a join takes and hands the peer a fresh sequence range.
        unschedule();
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
      deliver(open, msg);
    },
    reopen() {
      if (closed) return;
      // Drop any pending retry first, or it fires later against the router this call replaces and
      // tears down a link that is by then working.
      unschedule();
      attempt = 0;
      router?.close();
      router = null;
      options.onTransport?.(null);
      void connect();
    },
    close() {
      closed = true;
      unschedule();
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
    reopen: () => handle.current?.reopen(),
  };
}
