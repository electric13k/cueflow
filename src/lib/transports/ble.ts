import {
  BLE_FRAME, chunk, createReassembler, DEFAULT_TTL, fromBytes, messageIds, relayTtl, toBytes, transferMs,
} from "../mesh";
import { PayloadTooLarge, encodedSize, type Capability, type Envelope, type Link, type LinkStatus, type Transport } from "../transport";

/**
 * The show over Bluetooth, for a venue with no usable network.
 *
 * ## What this is, and what it is not
 *
 * A browser can only be a BLE **central**. The Web Bluetooth specification exposes the GATT client
 * role and nothing else: a page cannot advertise and cannot host a GATT server. So two browsers can
 * never talk to each other this way, however many phones are in the room. What this connects to is
 * a *host* -- a device running the CueFlow desktop or Android build, which does advertise -- and
 * that host is what relays between everyone else.
 *
 * That is why this is written as a transport rather than as a mesh in its own right. The relay lives
 * on the native side, where a device can hold both roles at once; `lib/mesh.ts` holds the framing
 * and the hop counting both sides share, so the two halves cannot disagree about the wire format.
 *
 * ## Why the payload limit is a policy and not the MTU
 *
 * A GATT write carries `MTU - 3` bytes, usually 244, and `chunk` splits anything larger. So the
 * limit here is not "what fits in a packet" -- it is "what is worth waiting for". Measured BLE
 * throughput on phones runs from roughly 2.7 kB/s to about 100 kB/s depending on the connection
 * interval, the PHY and whether Data Length Extension is negotiated at all. A cue is a couple of
 * hundred bytes and lands instantly at either end of that range. A deck of thirty cues is a few
 * kilobytes and takes under a second. A 180 KB script is over a minute on a slow link, and a show
 * that appears to hang is worse than one that says the script is not coming over Bluetooth.
 */

/**
 * 16-bit UUIDs are reserved by the Bluetooth SIG, so these are full 128-bit ones. Fixed, because
 * both ends have to agree and the host cannot be asked which it prefers before it is found.
 */
export const SHOW_SERVICE = "6f2c0001-9d4f-4d1a-9c6b-2b7f9b8b1a01";
/** Written to by a device with something to say. */
export const SHOW_INBOX = "6f2c0002-9d4f-4d1a-9c6b-2b7f9b8b1a01";
/** Notified on by the host, carrying everything the room should hear. */
export const SHOW_OUTBOX = "6f2c0003-9d4f-4d1a-9c6b-2b7f9b8b1a01";

/**
 * Big enough for a deck, too small for a script.
 *
 * Deliberately expressed as a time budget rather than a round number: `MAX_WAIT` is how long the
 * operator should ever be made to wait for one message on the slowest link worth supporting.
 */
const SLOW_LINK = 4_000;            // bytes/sec, the pessimistic end of measured phone throughput
const MAX_WAIT = 2_500;             // ms
const MAX_PAYLOAD = 8 * 1024;

const capability: Capability = { maxPayload: MAX_PAYLOAD, latency: "low", reach: "local" };

/** What the limit means in seconds, for the message the operator sees when something is refused. */
export const worstCaseWait = (bytes: number) => transferMs(bytes, SLOW_LINK);

type Bluetooth = {
  getAvailability?: () => Promise<boolean>;
  requestDevice: (options: unknown) => Promise<BluetoothDeviceLike>;
};
type BluetoothDeviceLike = {
  gatt?: {
    connect: () => Promise<{ getPrimaryService: (uuid: string) => Promise<GattServiceLike> }>;
    disconnect: () => void;
  };
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
type GattServiceLike = { getCharacteristic: (uuid: string) => Promise<GattCharacteristicLike> };
type GattCharacteristicLike = {
  writeValueWithoutResponse?: (value: BufferSource) => Promise<void>;
  writeValue?: (value: BufferSource) => Promise<void>;
  startNotifications: () => Promise<GattCharacteristicLike>;
  addEventListener: (type: string, listener: (event: Event) => void) => void;
  value?: DataView;
};

const bluetooth = () => (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;

let wanted = false;
/**
 * Call from the press that means it, then reopen the show link. Stays on for the session, so a
 * link that drops mid-show reconnects over Bluetooth without asking again.
 */
export const enableBluetooth = () => { wanted = true; };
export const disableBluetooth = () => { wanted = false; };
export const bluetoothWanted = () => wanted;
/** Whether this browser could do it at all. Chromium ships Web Bluetooth; Firefox and Safari do not. */
export const bluetoothPossible = () => !!bluetooth();

export const bleTransport: Transport = {
  id: "ble",
  label: "Bluetooth",
  capability,

  /**
   * Off unless the operator has asked for it, and that is not timidity.
   *
   * Opening a Bluetooth link means `requestDevice`, which puts the browser's own device chooser on
   * screen and only works inside a real user gesture. A router probing transports in the background
   * is not a gesture, so an eager `available()` would mean every show trying Bluetooth, failing, and
   * falling through to the cloud a moment later -- a delay and a console error on every join, in
   * exchange for nothing. `enableBluetooth()` is called from the press that means it.
   */
  available: async () => {
    if (!wanted) return false;
    const radio = bluetooth();
    if (!radio) return false;
    try { return radio.getAvailability ? await radio.getAvailability() : true; }
    catch { return false; }
  },

  open: async (show, onEnvelope, onDropped) => {
    const radio = bluetooth();
    if (!radio) throw new Error("This browser has no Bluetooth.");

    /**
     * The chooser is the permission. Web Bluetooth will not let a page scan silently, so this must
     * happen inside a real user gesture -- the operator pressing "Join over Bluetooth" -- and will
     * reject if it is called from a background probe.
     */
    const device = await radio.requestDevice({
      filters: [{ services: [SHOW_SERVICE] }],
      optionalServices: [SHOW_SERVICE],
    });
    if (!device.gatt) throw new Error("That device does not speak GATT.");

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SHOW_SERVICE);
    const inbox = await service.getCharacteristic(SHOW_INBOX);
    const outbox = await service.getCharacteristic(SHOW_OUTBOX);

    let status: LinkStatus = "open";
    const join = createReassembler();
    const nextId = messageIds();

    const drop = () => {
      if (status === "closed") return;
      status = "closed";
      join.forget();
      onDropped();
    };
    device.addEventListener("gattserverdisconnected", drop);

    await outbox.startNotifications();
    outbox.addEventListener("characteristicvaluechanged", event => {
      const value = (event.target as unknown as GattCharacteristicLike).value;
      if (!value) return;
      const done = join.accept(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
      if (!done) return;
      const envelope = fromBytes<Envelope>(done.body);
      // Anything that is not one of ours, or has run out of hops, stops here. The router above
      // does the deduplicating; this only has to stop obvious rubbish reaching it.
      if (!envelope || envelope.v !== 1 || envelope.show !== show) return;
      if (relayTtl(done.ttl) === null && done.ttl <= 0) return;
      onEnvelope(envelope);
    });

    /**
     * `writeValueWithoutResponse` is what makes this usable: with a response, every frame costs a
     * round trip and a deck takes many times longer. Frames are numbered and a message that never
     * completes is dropped, which is the trade that buys the speed.
     */
    const write = (frame: Uint8Array): Promise<void> => {
      const body = frame.slice().buffer;
      if (inbox.writeValueWithoutResponse) return inbox.writeValueWithoutResponse(body);
      if (inbox.writeValue) return inbox.writeValue(body);
      return Promise.reject(new Error("This characteristic cannot be written to."));
    };

    // One at a time and in order. Firing every frame at once overruns the controller's buffer on
    // most phones, and the frames that do not fit are dropped without telling anybody.
    let queue: Promise<void> = Promise.resolve();

    const link: Link = {
      transport: "ble",
      capability,
      get status() { return status; },
      send(envelope: Envelope) {
        const size = encodedSize(envelope);
        if (size > MAX_PAYLOAD) throw new PayloadTooLarge("ble", size, MAX_PAYLOAD);
        if (status !== "open") throw new Error("The Bluetooth link is closed.");
        const frames = chunk(toBytes(envelope), nextId(), DEFAULT_TTL, BLE_FRAME);
        queue = frames.reduce(
          (run, frame) => run.then(() => write(frame)),
          queue,
        ).catch(drop);
      },
      close() {
        status = "closed";
        device.removeEventListener("gattserverdisconnected", drop);
        join.forget();
        try { device.gatt?.disconnect(); } catch { /* already gone */ }
      },
    };
    return link;
  },
};

/** Stated once, here, so the message an operator sees is the same wherever it is shown. */
export const BLE_LIMITS = {
  maxPayload: MAX_PAYLOAD,
  slowLinkBytesPerSecond: SLOW_LINK,
  maxWaitMs: MAX_WAIT,
  /** A browser is a BLE client and nothing else, so a host device has to be running the native app. */
  needsNativeHost: true,
} as const;
