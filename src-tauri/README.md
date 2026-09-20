# CueFlow native shell

The web app runs a show fine when there is a network. This crate exists for when there is not.

A browser cannot open a raw UDP socket, cannot join a multicast group, and cannot advertise or
host a Bluetooth LE service. Calling a show from a booth, backstage and the wings, on a laptop
and three phones, with no venue Wi-Fi and no account, needs all three. So the same React app is
wrapped in a Tauri v2 shell that carries a Rust mesh: Wi-Fi for the fast path, Bluetooth LE for
discovery and for the moments when Wi-Fi is not there at all.

The crate is `cueflow` (lib name `cueflow_lib`), the bundle identifier is `app.cueflow.show`,
and the product name is `CueFlow`.

## Running it in development

```
npm run tauri dev
```

This starts Vite and the native window together; `tauri.conf.json` points `beforeDevCommand` at
`npm run dev` and `devUrl` at `http://localhost:5173`, so there is nothing to start by hand.

## Building a desktop installer locally

```
npm run tauri build
```

`beforeBuildCommand` is `npm run build`, so the web build runs inside the Tauri build. The
bundles land in `src-tauri/target/release/bundle/`: NSIS `.exe` and `.msi` on Windows,
`.AppImage` and `.deb` on Linux, `.dmg` on macOS.

No cargo feature flags are needed on any target. `build.rs` reads `CARGO_CFG_TARGET_OS` and sets
the `ble_peripheral` cfg on Windows, macOS and Linux only, which is what selects the BLE
peripheral role. A feature flag would have to be switched off by hand for Android, and the first
time someone forgot, the Android build would break for a reason unrelated to their change.

Linux needs the Tauri v2 system packages first: `libwebkit2gtk-4.1-dev`, `build-essential`,
`curl`, `wget`, `file`, `libxdo-dev`, `libssl-dev`, `libayatana-appindicator3-dev`,
`librsvg2-dev`, plus `libdbus-1-dev` and `pkg-config` for the Bluetooth stack.

## Android

Android builds need a JDK 17, the Android SDK, the NDK, and both `ANDROID_HOME` and `NDK_HOME`
pointing at them. **This developer's machine has none of that: no Java, no Android SDK, no
gradle, no adb.** The `.apk` is therefore built in CI only. Run the `native-release` workflow
from the Actions tab (it also runs on a `v*` tag) and download the APK from the run's artifacts.

On a machine that does have the toolchain, the commands are:

```
npm run tauri android init
npm run tauri android build --apk
```

`init` is idempotent and has to run before every build on a clean checkout, because
`src-tauri/gen/android` is generated rather than committed.

`init` writes `AndroidManifest.xml` from a template, so the permissions below are re-applied by
`node scripts/patch-android-manifest.mjs`, which both pipelines run between `init` and `build`.
Hand-editing the generated manifest does not survive the next build.

### Permissions the Android manifest needs

| Permission | Why |
| --- | --- |
| `BLUETOOTH_SCAN`, with `neverForLocation` | Finding the other devices in the room. `neverForLocation` is what lets the scan run without asking for location access, which CueFlow has no use for and should not be asking a stage manager to grant. |
| `BLUETOOTH_CONNECT` | Opening a GATT connection to a peer once it has been found. |
| `BLUETOOTH_ADVERTISE` | Being findable by the others rather than only doing the finding. See the gap below: this is declared for the role the app cannot play yet. |
| `ACCESS_WIFI_STATE` | Knowing whether Wi-Fi is up at all, so the mesh can decide between the fast path and the Bluetooth fallback. |
| `CHANGE_WIFI_MULTICAST_STATE` | Holding a multicast lock. Android drops multicast packets by default to save battery, and peer discovery on the LAN is multicast. |
| `INTERNET` | Local sockets count as `INTERNET` on Android, even when nothing leaves the room. |
| `ACCESS_LOCAL_NETWORK` | Android 17 (API 37) moves local network access behind its own runtime permission. Without it the LAN side of the mesh silently finds nobody on those devices. |

### Known gap: Android joins, it does not host

There is no way yet to host a BLE GATT server from Rust on Android; `ble-peripheral-rust` covers
Windows, macOS and Linux, and `btleplug` gives Android the central role only. So an Android
device can find a mesh and join it, but cannot be the one that hosts it. Every show needs at
least one desktop or laptop present to hold the mesh open. Closing this gap means a Kotlin side
plugin exposing the platform's own GATT server, which is not written.

## CI

`.github/workflows/native-release.yml` builds Windows, Linux and Android and attaches the lot to
a GitHub Release on a `v*` tag. `.gitlab-ci.yml` does the same on GitLab, with the Windows job
gated behind a `CI_WINDOWS_RUNNER` variable because hosted Windows runners are not on every
GitLab plan.
