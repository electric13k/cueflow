//! The offline CueFlow app.
//!
//! The website can do everything except be in a room with no internet, because a browser has no way
//! to reach another browser directly: Web Bluetooth is a GATT client and nothing else, and a page
//! served over https cannot open a socket to a bare LAN address. That is the entire reason this
//! binary exists. It ships the same interface, and underneath it runs a mesh the page could not.
//!
//! Four commands and two events is the whole surface. `src/lib/transports/native.ts` is the other
//! side of it, and it is registered ahead of the cloud transport, so a device that has this app
//! running prefers the room it is standing in over a datacentre it may not be able to reach.

mod android;
mod ble;
mod hub;
mod lan;
mod store;

use std::sync::{Arc, Mutex};

use hub::{Hub, MeshStatus};
use tauri::{AppHandle, Manager, State};

/// The running mesh, or nothing when the show has not been joined yet.
#[derive(Default)]
struct Mesh {
    hub: Mutex<Option<Arc<Hub>>>,
    /// Held for as long as a show is running. See `android.rs`: without it a phone hears broadcast
    /// beacons and misses multicast ones, which some access points make the only path there is.
    #[cfg(target_os = "android")]
    multicast: Mutex<Option<android::MulticastLock>>,
}

/// Join a show on this device's radios.
///
/// Starting twice is what happens when the operator reloads the window, so the old hub is stopped
/// first rather than leaving two sets of sockets fighting over port 7377.
#[tauri::command]
async fn mesh_start(app: AppHandle, show: String, device: String) -> Result<MeshStatus, String> {
    if show.trim().is_empty() || device.trim().is_empty() {
        return Err("A show needs an id and this device needs a name before it can join.".into());
    }

    let state = app.state::<Mesh>();
    if let Some(old) = state.hub.lock().unwrap().take() {
        old.stop();
    }

    // Taken before the planes start, because the LAN plane joins its multicast groups during start
    // and a join made while the radio filter is still closed is simply never heard.
    #[cfg(target_os = "android")]
    match android::hold_multicast_lock("cueflow-show") {
        Ok(lock) => *state.multicast.lock().unwrap() = Some(lock),
        Err(error) => tracing::warn!("{error}"),
    }

    let hub = Hub::new(app.clone());

    // A plane that will not start is reported and stepped over, never fatal. A venue with Bluetooth
    // switched off in the BIOS should still get the Wi-Fi half, and a laptop with no network should
    // still get Bluetooth. Refusing to join at all because one radio is missing would be the worst
    // possible answer twenty minutes before a house opens.
    match lan::start(&show, &device, Arc::clone(&hub)) {
        Ok(plane) => hub.attach(plane),
        Err(error) => tracing::warn!("the Wi-Fi half of the mesh did not start: {error}"),
    }
    match ble::start(&show, &device, Arc::clone(&hub)) {
        Ok(plane) => hub.attach(plane),
        Err(error) => tracing::warn!("the Bluetooth half of the mesh did not start: {error}"),
    }

    let status = hub.status();
    if status.planes.is_empty() {
        hub.stop();
        return Err("Neither Wi-Fi nor Bluetooth would start on this device, so there is no way to reach the room.".into());
    }

    *state.hub.lock().unwrap() = Some(hub);
    Ok(status)
}

#[tauri::command]
fn mesh_stop(state: State<Mesh>) {
    if let Some(hub) = state.hub.lock().unwrap().take() {
        hub.stop();
    }
    // Dropping the lock releases it. A phone that has left the show should not go on paying for an
    // open radio filter for the rest of the evening.
    #[cfg(target_os = "android")]
    drop(state.multicast.lock().unwrap().take());
}

/// One envelope, already serialised by the page.
///
/// The page owns the envelope shape (`src/lib/transport.ts`), so this side moves bytes and does not
/// parse them. That keeps one definition of the wire rather than two that can disagree.
#[tauri::command]
fn mesh_send(state: State<Mesh>, body: String) -> Result<(), String> {
    let hub = state.hub.lock().unwrap().clone();
    match hub {
        Some(hub) => {
            hub.publish(body.into_bytes());
            Ok(())
        }
        None => Err("This device has not joined a show yet.".into()),
    }
}

#[tauri::command]
fn mesh_status(state: State<Mesh>) -> MeshStatus {
    match state.hub.lock().unwrap().clone() {
        Some(hub) => hub.status(),
        None => MeshStatus { planes: Vec::new(), peers: 0 },
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Logs go to the console rather than a file. A show that is failing needs the person standing
    // at the desk to be able to see why, and RUST_LOG is how they turn the detail up.
    let _ = tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::from_default_env()).try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mesh::default())
        .invoke_handler(tauri::generate_handler![
            mesh_start,
            mesh_stop,
            mesh_send,
            mesh_status,
            store::store_put_asset,
            store::store_asset_url,
            store::store_list_assets,
            store::store_save_show,
            store::store_load_show,
            store::store_list_shows,
            store::store_delete_show,
            store::store_sweep,
            store::store_usage,
            store::store_baked_show,
        ])
        .run(tauri::generate_context!())
        .expect("CueFlow could not start a window.");
}
