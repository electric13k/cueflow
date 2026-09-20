// The Android manifest CueFlow needs, applied to the one Tauri generates.
//
// `tauri android init` writes `src-tauri/gen/android` from a template and that directory is not
// checked in, so CI regenerates it on every run. Anything hand-edited into the manifest is
// therefore lost on the next build, which is exactly the kind of failure nobody notices until an
// APK is in a venue and the Bluetooth half of the mesh silently never starts. This script is run
// after `init` and before `build` so the permissions are part of the build rather than part of
// somebody's memory.
//
// Idempotent: running it twice leaves one copy of each line, because the CI step that calls it also
// runs on machines where `gen/android` happens to have survived from a previous job.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifest = resolve("src-tauri/gen/android/app/src/main/AndroidManifest.xml");

if (!existsSync(manifest)) {
  console.error(`No manifest at ${manifest}. Run \`npm run tauri android init\` first.`);
  process.exit(1);
}

/**
 * Why each of these is here. A permission with no reason attached is one nobody dares remove later.
 *
 * The Bluetooth split at API 31 is the fiddly part. Before Android 12 a BLE scan counted as
 * location, so a scanning app had to hold `ACCESS_FINE_LOCATION` and users saw a location prompt for
 * a cue board. From 31 the scan permission is its own thing and `neverForLocation` is the assertion
 * that we are not deriving position from what we find, which is what keeps that prompt away. Both
 * sets ship, each capped to the range where it applies.
 */
const PERMISSIONS = [
  // The mesh itself.
  `<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" tools:targetApi="31" />`,
  `<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" tools:targetApi="31" />`,
  `<uses-permission android:name="android.permission.BLUETOOTH_ADVERTISE" tools:targetApi="31" />`,
  `<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />`,
  `<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />`,
  // Only up to 30, and only because a BLE scan was legally a location fix before Android 12.
  `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" android:maxSdkVersion="30" />`,

  // The Wi-Fi half. `CHANGE_WIFI_MULTICAST_STATE` is what allows a MulticastLock, and without a
  // held lock Android drops multicast frames before they reach the socket, so peer discovery
  // degrades to broadcast only.
  `<uses-permission android:name="android.permission.INTERNET" />`,
  `<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />`,
  `<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />`,
  `<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />`,
  // Android 17 (API 37) put local network traffic behind its own runtime permission. Declaring it
  // on older releases is harmless; not declaring it on 17 means every LAN socket fails.
  `<uses-permission android:name="android.permission.ACCESS_LOCAL_NETWORK" />`,

  // A show runs for hours and a phone in a pocket goes into Doze, which suspends sockets. A
  // foreground service of type connectedDevice is what keeps the link alive across an interval.
  `<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />`,
  `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE" />`,
  `<uses-permission android:name="android.permission.WAKE_LOCK" />`,
];

// Required false: a tablet with no BLE radio should still install and still take the Wi-Fi half of
// the mesh. Requiring it would hide the app from those devices in the store listing.
const FEATURES = [
  `<uses-feature android:name="android.hardware.bluetooth_le" android:required="false" />`,
  `<uses-feature android:name="android.hardware.wifi" android:required="false" />`,
];

let xml = readFileSync(manifest, "utf8");
const before = xml;

// `tools:targetApi` needs the tools namespace, and the generated manifest does not always carry it.
if (!xml.includes("xmlns:tools=")) {
  xml = xml.replace(
    /<manifest([^>]*?)xmlns:android="http:\/\/schemas\.android\.com\/apk\/res\/android"/,
    `<manifest$1xmlns:android="http://schemas.android.com/apk/res/android"\n    xmlns:tools="http://schemas.android.com/tools"`,
  );
}

const wanted = [...PERMISSIONS, ...FEATURES].filter(line => {
  // Match on the name attribute rather than the whole line, so a template that already declares
  // INTERNET with different formatting is not duplicated.
  const name = line.match(/android:name="([^"]+)"/)?.[1];
  return name ? !xml.includes(`android:name="${name}"`) : true;
});

if (wanted.length) {
  const block = wanted.map(line => `    ${line}`).join("\n");
  if (!xml.includes("<application")) {
    console.error("The generated manifest has no <application> element, so there is nowhere to anchor the permissions.");
    process.exit(1);
  }
  xml = xml.replace(/(\n\s*)<application/, `\n${block}\n$1<application`);
}

/**
 * Plain HTTP on the LAN.
 *
 * Android has blocked cleartext by default since API 28. The mesh itself is raw TCP and is not
 * governed by that policy, but the moment a host device serves the app over http to a phone on the
 * same network, which is the install-free way to get a crew joined, the policy applies. Turning it
 * on globally is broader than ideal; a network security config scoped to private ranges would be
 * tighter and is the thing to do if this app ever talks to a public host over http, which it does
 * not today.
 */
if (!/android:usesCleartextTraffic=/.test(xml)) {
  xml = xml.replace(/<application\b/, `<application\n        android:usesCleartextTraffic="true"`);
}

if (xml === before) {
  console.log("Android manifest already has everything CueFlow needs.");
} else {
  writeFileSync(manifest, xml);
  console.log(`Patched ${manifest}: ${wanted.length} declaration(s) added.`);
}
