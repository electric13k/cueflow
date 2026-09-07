# The Bluetooth mesh

The plan is a show that runs with no network at all: devices find each other over Bluetooth and pass
cues between themselves. Wi-Fi is out of scope, by decision.

This is what the radio and the platforms will actually allow, what is built, and what is left. The
constraints are not preferences — three of them rule out designs that sound obvious.

---

## Four constraints, in the order they bite

**1. A browser cannot be a Bluetooth peer.** The Web Bluetooth API exposes the GATT *client* role
only. A page cannot advertise and cannot host a GATT server. So two browsers can never talk to each
other over Bluetooth, however many phones are in the room. Every mesh topology needs at least one
device that advertises, and that device has to be running a native build.

Also: Chromium ships Web Bluetooth on desktop and Android; Firefox and Safari, on every platform,
do not. A crew member on an iPhone cannot join over Bluetooth from a browser at all.

**2. No Rust crate does BLE peripheral on Android.** `btleplug`, which `tauri-plugin-blec` wraps, is
central-only and says so. For peripheral there is `ble-peripheral-rust` — but its backends are
`bluez`, `corebluetooth` and `winrt`. There is no Android backend, and the crate is 61 stars and 13
commits. `bluster` is BlueZ only. `blew` aims at macOS, iOS, Android and Linux, and therefore not
Windows.

So Android peripheral means writing a Tauri plugin in Kotlin against `BluetoothLeAdvertiser` and
`BluetoothGattServer`. There is no library to lean on. Windows is better served: WinRT has
`GattServiceProvider` and `BluetoothLEAdvertisementPublisher`, and `ble-peripheral-rust`'s `winrt`
backend wraps them, though it is a small crate to be depending on.

**3. This is not SIG Bluetooth Mesh.** The Bluetooth SIG's Mesh profile is a provisioned network
built for lighting and sensors. It is not reachable from Web Bluetooth, not exposed by any of the
Rust crates above, and it would mean commissioning every phone in the building before a rehearsal.
What is built here is a small flood over ordinary GATT connections: framed messages, a hop count,
and duplicate suppression. That is the thing that can be built with what the platforms expose.

**4. Bandwidth decides what may travel.** A GATT write carries `MTU - 3` bytes — 244 at the usual
negotiated MTU of 247, and 20 on a phone that never negotiates. Measured throughput on phones runs
from roughly 2.7 kB/s at the pessimistic end to about 100 kB/s where Data Length Extension and a
short connection interval both land; the 2 Mbps PHY can reach ~179 kB/s in theory.

| What | Size | Worst case at 4 kB/s |
|---|---|---|
| One cue | ~200 B | instant |
| A deck of 30 cues | ~4 KB | ~1 second |
| A deck with a 180 KB script | ~184 KB | ~46 seconds |
| Any audio file | megabytes | no |

So cues and decks go over Bluetooth. Scripts and audio do not. `bleTransport.capability.maxPayload`
is 8 KB, and the router raises `PayloadTooLarge` rather than letting a show appear to hang — which
is exactly why that limit is on the `Transport` interface.

---

## What is built

`src/lib/mesh.ts` — the wire format, and the only part both halves must agree on.

- `chunk` cuts a message into numbered frames that fit a GATT write; `createReassembler` puts them
  back together, tolerates frames arriving out of order or twice, and drops a message whose
  remaining frames never came. Both bounded, because a device walking out of range mid-message must
  not leave a fragment held for the rest of the night.
- `relayTtl` counts a message down as it is passed on, and stops it at zero. Without it, two devices
  in range of each other pass one cue back and forth until the batteries die.
- `transferMs` computes what a message of a given size costs on a link of a given speed. Worth being
  able to compute rather than guess, because it is what decides the payload limit.

23 tests. No platform involved, so it is testable and tested.

`src/lib/transports/ble.ts` — the browser half, as a `Transport`. Connects to a host as a GATT
client, writes frames without response (with a response, every frame costs a round trip), and
reassembles notifications from the host. Off unless `enableBluetooth()` is called from a real user
press, because `requestDevice` puts the browser's own chooser on screen and will not run from a
background probe.

The service and characteristic UUIDs are fixed in that file. Both halves have to agree and the host
cannot be asked which it prefers before it has been found.

---

## What is left, and roughly what it costs

The host half. A device that advertises `SHOW_SERVICE`, accepts writes on `SHOW_INBOX`, notifies on
`SHOW_OUTBOX`, and relays between everyone connected to it, using the same framing and hop counting
from `lib/mesh.ts`.

1. **Tauri v2 shell** for Windows and Android. Already the agreed direction.
2. **Windows host** — `ble-peripheral-rust`'s `winrt` backend, plus `btleplug` for the central role
   so a Windows machine can also connect outward. Prototype the crate before committing to it.
3. **Android host** — a Kotlin Tauri plugin over `BluetoothLeAdvertiser` and `BluetoothGattServer`.
   No crate to lean on. Needs `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN`
   (`neverForLocation`), and a foreground service of type `connectedDevice` to survive Doze.
4. **Fan-out limits.** Android holds roughly seven GATT connections, fewer on some hardware. A room
   larger than that needs a second device relaying, which is what the hop count is for.
5. **A device chooser in the UI**, since Web Bluetooth's chooser only exists in the browser build.

Not needed, and worth saying so: no Wi-Fi work at all — no soft AP, no UDP discovery, no mDNS, no
`ACCESS_LOCAL_NETWORK` on Android 17, no Windows Firewall rules. Dropping the Wi-Fi half removes
most of the platform-specific risk that made the earlier plan expensive.

---

## Testing it

The mesh layer is covered by unit tests and needs no radio. The transport does not: Web Bluetooth
cannot be exercised in happy-dom, and mocking it would only test the mock. It needs two real devices
and the host half to exist, so it is deliberately thin — framing and hop logic live in `mesh.ts`
where they can be tested, and `ble.ts` holds only the calls into the platform.

## Sources

- [Web Bluetooth: Chrome for Developers](https://developer.chrome.com/docs/capabilities/bluetooth)
- [Web Bluetooth specification, WebBluetoothCG](https://webbluetoothcg.github.io/web-bluetooth/)
- [btleplug README — central only, points to bluster and ble-peripheral-rust](https://github.com/deviceplug/btleplug)
- [ble-peripheral-rust — backends are bluez, corebluetooth, winrt](https://github.com/rohitsangwan01/ble-peripheral-rust)
- [tauri-plugin-blec — BLE client plugin](https://github.com/MnlPhlp/tauri-plugin-blec)
- [A Practical Guide to BLE Throughput, Memfault](https://interrupt.memfault.com/blog/ble-throughput-primer)
- [Maximizing BLE Throughput on iOS and Android, Punch Through](https://punchthrough.com/maximizing-ble-throughput-on-ios-and-android/)
