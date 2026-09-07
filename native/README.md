# The native half

A browser can only be a BLE central. Web Bluetooth exposes the GATT client role and nothing else —
a page can neither advertise nor host a GATT server — so every device that relays for the room has
to be native. This directory is that half.

## What is here

`cueflow-mesh` — the wire format, in Rust, with no Bluetooth dependency at all.

It is deliberately a mirror of `src/lib/mesh.ts`. The two ends have to agree on every byte, and the
way to keep them agreeing is for both to be short, both to be tested, and both to assert the same
hand-written fixture: `frame_layout_is_fixed` here, `describe("the wire format")` there. Neither is
generated from the other, so a change to either that the other does not know about fails a test on
one side rather than in a venue with the two halves quietly disagreeing about where a message ends.

```bash
cargo test --manifest-path native/cueflow-mesh/Cargo.toml
```

16 tests, no radio needed.

## What is not here yet, and why

The Bluetooth binding, and the Tauri shell around it. Both were left out rather than sketched,
because neither can be compiled or run on the machine this was written on: there is a Rust
toolchain but no Java and no Android SDK. Rust that has never been built is not progress.

What it needs, in the order the risk sits:

1. **Android host.** `BluetoothLeAdvertiser` and `BluetoothGattServer`, from a Kotlin Tauri plugin.
   There is no crate for this — `btleplug` (which `tauri-plugin-blec` wraps) is central-only and
   says so, `ble-peripheral-rust` has bluez, corebluetooth and winrt backends and no Android one,
   and `bluster` is BlueZ only. Needs `BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` and
   `BLUETOOTH_SCAN` with `neverForLocation`, plus a foreground service of type `connectedDevice` to
   survive Doze.
2. **Windows host.** WinRT has `GattServiceProvider` and `BluetoothLEAdvertisementPublisher`, and
   `ble-peripheral-rust`'s `winrt` backend wraps them — but it is 61 stars and 13 commits, so
   prototype it before committing. `btleplug` covers the central role so a Windows machine can also
   connect outward.
3. **The relay itself.** Accept writes on `SHOW_INBOX`, notify on `SHOW_OUTBOX`, and forward what
   arrives to every other connected device with `relay_ttl` applied. The dedup lives in the router
   above (`src/lib/transport.ts`), so the host only has to count hops and not echo to the sender.

The service and characteristic UUIDs are fixed in `src/lib/transports/ble.ts`. Both halves have to
agree and the host cannot be asked which it prefers before it has been found.

Android holds roughly seven GATT connections, fewer on some hardware, which is the reason the hop
count exists: a room larger than that needs a second device relaying.
