# The native half

A browser cannot mesh. Web Bluetooth exposes the GATT client role and nothing else, so a page can
neither advertise nor host a GATT server and two browsers can never reach each other that way; and a
page served over https cannot open a socket to a bare LAN address, because that is mixed content.
Every device that carries a show without the internet therefore has to be native. This directory,
and `../src-tauri`, are that half.

## What is here

`cueflow-mesh` — the wire format, in Rust, with no Bluetooth dependency at all.

It is deliberately a mirror of `src/lib/mesh.ts`. The two ends have to agree on every byte, and the
way to keep them agreeing is for both to be short, both to be tested, and both to assert the same
hand-written fixture: `frame_layout_is_fixed` here, `describe("the wire format")` there. Neither is
generated from the other, so a change to either that the other does not know about fails a test on
one side rather than in a venue with the two halves quietly disagreeing about where a message ends.

```sh
cargo test --manifest-path native/cueflow-mesh/Cargo.toml
```

16 tests, no radio needed.

## What uses it

`../src-tauri` is the app. Its `src/ble.rs` is the Bluetooth binding this file used to say was
missing; it takes this crate's framing and hop counting and puts a radio under them. `src/lan.rs` is
the other half of the hybrid, and `src/hub.rs` is what makes the two one mesh rather than two
separate ones: everything a plane hears is deduped, handed to the window, and re-flooded to the
other plane, so a phone on Bluetooth hears a cue that was sent over Wi-Fi.

Read `../src-tauri/README.md` for how to build and run it.

## The gap that is still real

**Android cannot host.** `BluetoothLeAdvertiser` and `BluetoothGattServer` are Java classes and there
is no Rust crate that reaches them: `btleplug` is central-only and says so, `ble-peripheral-rust` has
bluez, corebluetooth and winrt backends and no Android one, and `bluster` is BlueZ only. So an
Android device joins a host over Bluetooth and relays over Wi-Fi, but cannot be the Bluetooth host
itself. `ble.rs` reports that in its status line rather than failing quietly.

Closing it means a Kotlin Tauri plugin holding the advertiser and the GATT server, needing
`BLUETOOTH_ADVERTISE`, `BLUETOOTH_CONNECT` and `BLUETOOTH_SCAN` with `neverForLocation`, plus a
foreground service of type `connectedDevice` to survive Doze. The permissions are already written by
`scripts/patch-android-manifest.mjs`; the plugin is not.

In practice a laptop is usually in the room and is the Bluetooth host, and every Android device in
range of the same Wi-Fi is a full peer on that plane, so the gap costs a phone-only room rather than
a normal one.

Android holds roughly seven GATT connections, fewer on some hardware, which is the reason the hop
count exists: a room larger than that needs a second device relaying.
