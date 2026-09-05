import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "../store";
import { PayloadTooLarge, encodedSize, type Capability, type Envelope, type Link, type LinkStatus, type Transport } from "../transport";

/**
 * The show over Supabase Realtime: the original wire, now one option among several.
 *
 * Reach is its whole point -- anyone holding the show id joins from anywhere, no shared network
 * needed -- and that is also its whole weakness, because it needs the venue to have working
 * internet. Latency is "medium" rather than "low" because every message makes a round trip to a
 * datacentre and back, which a link across the room does not.
 */

/** Realtime refuses a payload much past 256 KB. `SCRIPT_LIMIT` in shows.ts already sits under this. */
const MAX_PAYLOAD = 250_000;

/** How long to wait for the socket to join before giving up and letting the router try elsewhere. */
const JOIN_TIMEOUT = 8_000;

const capability: Capability = { maxPayload: MAX_PAYLOAD, latency: "medium", reach: "internet" };

export const cloudTransport: Transport = {
  id: "cloud",
  label: "Cloud",
  capability,

  available: async () => !!supabase && (typeof navigator === "undefined" || navigator.onLine !== false),

  open: (show, onEnvelope, onDropped) => new Promise<Link>((resolve, reject) => {
    const client = supabase;
    if (!client) { reject(new Error("Cloud is not configured for this build.")); return; }

    let status: LinkStatus = "closed";
    let settled = false;
    const channel: RealtimeChannel = client.channel(`show:${show}`, { config: { broadcast: { self: false } } });

    const link: Link = {
      transport: "cloud",
      capability,
      get status() { return status; },
      send(envelope: Envelope) {
        const size = encodedSize(envelope);
        if (size > MAX_PAYLOAD) throw new PayloadTooLarge("cloud", size, MAX_PAYLOAD);
        void channel.send({ type: "broadcast", event: "msg", payload: envelope });
      },
      close() {
        status = "closed";
        void client.removeChannel(channel);
      },
    };

    /**
     * The old `showChannel` called `.subscribe()` and returned immediately, so the first message --
     * the joiner's `here`, which is what asks the host for the deck -- was routinely sent before the
     * socket had joined and was dropped on the floor. That is the crew device stuck forever on
     * "Waiting for the host to send the deck". The link is not handed back until the channel is
     * actually subscribed.
     */
    const giveUp = setTimeout(() => {
      if (settled) return;
      settled = true;
      void client.removeChannel(channel);
      reject(new Error("The cloud channel did not connect in time."));
    }, JOIN_TIMEOUT);

    channel.on("broadcast", { event: "msg" }, ({ payload }) => onEnvelope(payload as Envelope));
    channel.subscribe(state => {
      if (state === "SUBSCRIBED") {
        if (settled) return;
        settled = true;
        clearTimeout(giveUp);
        status = "open";
        resolve(link);
        return;
      }
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        const wasOpen = status === "open";
        status = "closed";
        if (!settled) {
          settled = true;
          clearTimeout(giveUp);
          void client.removeChannel(channel);
          reject(new Error(`The cloud channel closed with ${state}.`));
          return;
        }
        // Dropped after it was working. The router re-probes, which is how a show survives the
        // venue's wifi going down mid-performance.
        if (wasOpen) onDropped();
      }
    });
  }),
};
