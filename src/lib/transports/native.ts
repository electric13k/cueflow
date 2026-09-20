import { PayloadTooLarge, deviceId, encodedSize, type Capability, type Envelope, type Link, type LinkStatus, type Transport } from "../transport";

/**
 * The show over the native app's local mesh: the wire for a venue with no internet at all.
 *
 * Everything that makes this a mesh happens in Rust. A browser can only ever be a BLE central, so
 * two browsers could never reach each other and the old Web Bluetooth transport was a client of a
 * host rather than a mesh. The native build holds both roles at once and runs wifi and Bluetooth
 * side by side, so a phone that cannot see the host directly is still reached through whichever
 * device can. This file is only the seam: it starts that mesh, hands it envelopes, and hands back
 * what arrives.
 *
 * Latency is "low" and reach is "local" because both are literally true: a message crosses the room
 * and stops there, without a round trip to a datacentre. `maxPayload` is 256 KB rather than the few
 * kilobytes a single GATT link was worth, because the Rust side fragments and reassembles across
 * whichever plane is fastest, and the wifi plane carries a full script in well under a second.
 */

/** Matches the ceiling the Rust side enforces. `SCRIPT_LIMIT` in shows.ts already sits under it. */
const MAX_PAYLOAD = 256 * 1024;

const capability: Capability = { maxPayload: MAX_PAYLOAD, latency: "low", reach: "local" };

/**
 * What the Rust side says about the room.
 *
 * Per plane rather than one number, because "3 peers" tells an operator nothing about why the
 * device across the stage went quiet. `detail` is the plane's own words for its state, so the app
 * can show "wifi: 2 peers on cueflow-lan, bluetooth: scanning" without this file knowing what a
 * plane is.
 */
export type MeshStatus = { planes: { id: string; peers: number; detail: string }[]; peers: number };

/**
 * Whether we are running inside the native shell at all.
 *
 * Checked against the injected global rather than a build flag, because the same bundle is served
 * to the website and loaded by the native app, and only one of the two has a Rust side to talk to.
 */
const tauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** For UI that wants to say why the mesh is not on offer, without opening a link to find out. */
export const meshPossible = () => tauri();

/**
 * A frame the Rust side mangled must not take the listener down with it.
 *
 * Tauri's event callback has nowhere to report a throw: it is called from the webview's own
 * dispatch, so one bad payload would surface as an unhandled rejection and every later envelope on
 * that channel would still be delivered to a handler nobody is watching. Logged and dropped, which
 * is the same answer the reassembler gives an incomplete message.
 */
const parseEnvelope = (body: unknown): Envelope | null => {
  if (typeof body !== "string") return null;
  try {
    return JSON.parse(body) as Envelope;
  } catch (error) {
    console.warn("[mesh] dropped an envelope that would not parse", error);
    return null;
  }
};

/** What the mesh looks like right now, or null when there is no Rust side to ask. */
export async function meshStatus(): Promise<MeshStatus | null> {
  if (!tauri()) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<MeshStatus>("mesh_status");
  } catch {
    // The command is missing or the shell is older than this bundle. Not knowing is not an error.
    return null;
  }
}

export const nativeTransport: Transport = {
  id: "mesh",
  label: "Local mesh",
  capability,

  /**
   * True whenever there is a Rust side, with no IPC round trip to confirm it.
   *
   * The router probes on every reconnect, and a show that loses wifi twice a night should not pay
   * a command call each time to be told what the injected global already says. If the mesh cannot
   * actually start, `open` rejects and the router falls through to the cloud in the usual way.
   */
  available: async () => tauri(),

  open: async (show, onEnvelope, onDropped) => {
    if (!tauri()) throw new Error("The local mesh only exists inside the CueFlow app.");

    // Imported here and never at module scope. A static import puts the Tauri API into the website
    // bundle, where nothing can call it and `__TAURI_INTERNALS__` is never there to begin with.
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");

    let status: LinkStatus = "closed";

    const started = await invoke<MeshStatus>("mesh_start", { show, device: deviceId() });
    status = "open";
    /**
     * Peers as of the last status event, so we can tell "still alone" from "just lost the room".
     * Only the second one is worth a reconnect.
     */
    let peers = started?.peers ?? 0;

    const stopEnvelopes = await listen<string>("mesh://envelope", event => {
      const envelope = parseEnvelope(event.payload);
      // Anything that is not one of ours stops here. The router above does the deduplicating; this
      // only has to keep obvious rubbish from reaching it.
      if (!envelope || envelope.v !== 1 || envelope.show !== show) return;
      onEnvelope(envelope);
    });

    const stopStatus = await listen<MeshStatus>("mesh://status", event => {
      if (status !== "open") return;
      const next = event.payload;
      if (!next || typeof next.peers !== "number") return;
      const had = peers;
      peers = next.peers;
      /**
       * Every peer gone after there was at least one is the mesh equivalent of the socket closing:
       * the radios are still up and sending happily into an empty room, so nothing errors and the
       * operator keeps calling cues nobody receives. Reporting it makes the router re-probe, which
       * is what puts the show back on the cloud when the crew has walked out of range.
       */
      if (had > 0 && next.peers === 0) onDropped();
    });

    const link: Link = {
      transport: "mesh",
      capability,
      get status() { return status; },
      send(envelope: Envelope) {
        const size = encodedSize(envelope);
        if (size > MAX_PAYLOAD) throw new PayloadTooLarge("mesh", size, MAX_PAYLOAD);
        // Sent as a JSON string rather than a structure: the Rust side owns the fragmenting, and
        // handing it the exact bytes it will frame keeps the two ends from disagreeing about how
        // serde and the webview's own serialiser each spell the same envelope.
        void invoke("mesh_send", { body: JSON.stringify(envelope) }).catch(() => {
          // The command failed, so the Rust side is gone or the mesh stopped under us. Same answer
          // as a dead socket: tell the router, and let it find another wire.
          if (status === "open") onDropped();
        });
      },
      close() {
        status = "closed";
        // Unlisten before stopping. A `mesh://envelope` emitted while the Rust side winds down
        // would otherwise be parsed into a link the router has already replaced, and every switch
        // would leave another live listener feeding a closed link.
        stopEnvelopes();
        stopStatus();
        void invoke("mesh_stop").catch(() => undefined);
      },
    };
    return link;
  },
};
