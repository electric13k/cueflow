//! The show over Bluetooth, on a device that can hold both ends of a link.
//!
//! ## Two roles, and why both have to run at once
//!
//! A BLE device is a *central* (it scans, connects and writes) or a *peripheral* (it advertises and
//! hosts a GATT server), and most software is only ever one of them. A browser is a central and
//! nothing else, which is why `src/lib/transports/ble.ts` can only ever be a client of a host: two
//! pages can never talk to each other however many phones are in the room. That limit is the reason
//! this file exists.
//!
//! Here a device runs both roles at the same time, and that is what turns a star into a mesh. The
//! laptop at the desk hosts a GATT server that the phones in the wings join, *and* joins the GATT
//! server the laptop in the booth is hosting. A cue written to this device's inbox by a phone is
//! notified straight back out to the booth, so the two halves of the building are in one show even
//! though no phone can see any other phone.
//!
//! ## Which platform can do which
//!
//! | role       | crate                | Windows | macOS | Linux | Android |
//! |------------|----------------------|---------|-------|-------|---------|
//! | central    | `btleplug`           | yes     | yes   | yes   | yes     |
//! | peripheral | `ble-peripheral-rust`| yes     | yes   | yes   | **no**  |
//!
//! `btleplug` has no peripheral role at all, on any platform, and there is no Rust crate that gives
//! Android one: on Android the GATT server is `BluetoothGattServer`, which needs a Kotlin Tauri
//! plugin CueFlow does not ship yet. So a phone joins, and does not host. That is a worse mesh than
//! a laptop gets, and it is still a working show, so `start` succeeds with whichever half the device
//! can actually do and `detail()` says plainly which half that is. A missing radio role is never a
//! silent no-op and never a failed start: a stage manager who is told "Bluetooth failed" ten minutes
//! before the house opens has no way to know the phones would have worked fine.
//!
//! ## Framing
//!
//! None of it is invented here. `cueflow_mesh` holds the frame layout, the hop counting and the
//! reassembly, and `src/lib/mesh.ts` is the same format on the page side, checked against the same
//! hand written fixture. This file moves those frames over a radio and does not reinterpret them.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU8, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use anyhow::anyhow;
use btleplug::api::{
    Central, CharPropFlags, Characteristic, Manager as _, Peripheral as _, ScanFilter, WriteType,
};
use btleplug::platform::{Adapter, Manager, Peripheral};
use cueflow_mesh::{chunk, relay_ttl, BLE_FRAME};
use cueflow_mesh::{ChunkError, Message, MessageIds, Reassembler};
use futures::StreamExt;
use tokio::runtime::{Builder, Handle, Runtime};
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};
use uuid::Uuid;

use crate::hub::{Hub, Plane};

/// The name this plane reports to the hub. The hub keys its cross plane relay on it, so it has to
/// match the string `lib.rs` and the page both expect.
const BLE: &str = "ble";

// The UUIDs are the fixed half of the contract with `src/lib/transports/ble.ts`. They are written
// twice on purpose: once as the 128 bit value the radio actually uses, and once as the text the
// page has, with a test asserting the two agree. A typo in a hand written u128 is invisible, and
// the failure it causes is "the host is advertising but nobody can find it", which is the worst
// kind of bug to chase in a venue an hour before curtain.
//
// `Uuid::from_u128` is a const fn, so these are built at compile time with no parse and no unwrap.
/// The show itself. A device advertising this is hosting a CueFlow show.
pub const SHOW_SERVICE: Uuid = Uuid::from_u128(0x6f2c_0001_9d4f_4d1a_9c6b_2b7f_9b8b_1a01);
/// Written to by a device with something to say.
pub const SHOW_INBOX: Uuid = Uuid::from_u128(0x6f2c_0002_9d4f_4d1a_9c6b_2b7f_9b8b_1a01);
/// Notified on by the host, carrying everything the room should hear.
pub const SHOW_OUTBOX: Uuid = Uuid::from_u128(0x6f2c_0003_9d4f_4d1a_9c6b_2b7f_9b8b_1a01);

/// The same three, as the page spells them. Only the tests read these, so they are built only for
/// tests: three unused constants in the shipped binary is three warnings nobody will ever act on.
#[cfg(test)]
const SHOW_SERVICE_TEXT: &str = "6f2c0001-9d4f-4d1a-9c6b-2b7f9b8b1a01";
#[cfg(test)]
const SHOW_INBOX_TEXT: &str = "6f2c0002-9d4f-4d1a-9c6b-2b7f9b8b1a01";
#[cfg(test)]
const SHOW_OUTBOX_TEXT: &str = "6f2c0003-9d4f-4d1a-9c6b-2b7f9b8b1a01";

/// How many part finished messages one link may hold, and how long a gap before one is abandoned.
///
/// Per link rather than shared, because two peers can pick the same two byte message id in the same
/// second and stitching their frames together would produce a message that is neither of theirs.
const PENDING_LIMIT: usize = 32;
const EXPIRE_MS: u64 = 20_000;

/// How often the scan sweep looks at what the adapter has seen.
///
/// This is the whole reconnection story. Nobody presses anything to rejoin: a phone that was carried
/// out to the dock and comes back is simply seen again on the next sweep and connected again. Two
/// seconds is short enough that a walk back into range feels immediate and long enough that the
/// sweep is not what drains the battery.
const SWEEP: Duration = Duration::from_secs(2);
/// Sweeps between reissuing `start_scan`. Some backends quietly stop scanning after a while, and a
/// host that appeared during the gap would otherwise never be found.
const RESCAN_AFTER: u32 = 8;
/// btleplug will wait on a connect indefinitely when a device advertised and then walked away.
const CONNECT_WAIT: Duration = Duration::from_secs(12);
const DISCOVER_WAIT: Duration = Duration::from_secs(12);
/// How often a link checks it is still a link, for backends that do not end the notification stream
/// when the peer disappears.
const LIVENESS: Duration = Duration::from_secs(5);
/// How long a retry waits after the adapter itself refused, e.g. the radio is switched off.
const RADIO_RETRY: Duration = Duration::from_secs(5);
/// How long `stop` lets the host half put its advert away before the task is taken out from under
/// it. An advert left running after the show is closed is a ghost host that phones keep joining.
const STOP_GRACE: Duration = Duration::from_millis(600);

const ROLE_STARTING: u8 = 0;
const ROLE_RUNNING: u8 = 1;
const ROLE_OFF: u8 = 2;

/// One message, already cut into frames, ready for whichever role can put it on the air.
type Frames = Arc<Vec<Vec<u8>>>;

/// A poisoned lock means some other task panicked while holding it. The data behind these locks is
/// a peer count and a set of ids; none of it is worth losing a show over, so take it back and carry
/// on rather than panicking every later caller too.
fn guard<T>(lock: &Mutex<T>) -> MutexGuard<'_, T> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Monotonic milliseconds for the reassembler, which deliberately has no clock of its own.
fn ms_since(base: Instant) -> u64 {
    base.elapsed().as_millis() as u64
}

/// How many recently handled messages this plane remembers, for the relay decision only.
///
/// A show's worth of traffic passes through here in a few seconds at this size, which is far longer
/// than a message can still be bouncing around a room.
const ECHOES: usize = 128;

/// The gate that stops this plane shouting at itself.
///
/// The hub has a gate of its own, and it is not this one. The hub's decides what reaches the window
/// and what crosses to Wi-Fi; it cannot be asked about a message from here, because `Hub::inbound`
/// takes the bytes and tells the caller nothing. This one decides one thing: whether to put a
/// message back on the air. It exists because BLE is the only plane that forwards inside itself.
///
/// Without it, three phones joined to one laptop each write every cue they hear back to that
/// laptop, which notifies it out again, and the hop count only bounds that at four rounds of it. On
/// a radio that moves a few kilobytes a second, four rounds of a deck is the show stopping.
struct Echoes {
    /// A ring rather than a set: a hundred and twenty eight comparisons cost nothing next to one
    /// radio write, and this way there is no allocation on the path a cue takes.
    marks: [u64; ECHOES],
    next: usize,
}

impl Echoes {
    fn new() -> Self {
        Self { marks: [0; ECHOES], next: 0 }
    }

    /// True the first time these bytes are offered, false while they are still remembered.
    ///
    /// A message whose mark is exactly zero collides with the empty ring and is not relayed. That is
    /// one message in every eighteen quintillion, and it still reaches this device's own window.
    fn first(&mut self, mark: u64) -> bool {
        if self.marks.contains(&mark) {
            return false;
        }
        self.marks[self.next] = mark;
        self.next = (self.next + 1) % ECHOES;
        true
    }
}

/// FNV-1a, the same cheap hash the hub uses for the same reason. Not a security boundary: it only
/// has to tell two messages apart within one show, and hashing every message on a phone with
/// something cryptographic would cost more than it buys.
fn mark_of(body: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in body {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// Everything the tasks share. Split out from `BlePlane` so the tasks can hold it without holding
/// the handles that abort them, which would be a cycle nothing ever frees.
struct Shared {
    hub: Arc<Hub>,
    show: String,
    device: String,
    rt: Handle,
    /// Message ids for things this device says. Two bytes, and they only have to be unique among
    /// what is in flight.
    ids: Mutex<MessageIds>,
    /// What this plane has already put on the air, so it does not put it there again.
    echoes: Mutex<Echoes>,
    /// Hosts this device has joined.
    hosts: AtomicUsize,
    /// Devices that have joined the server this device is hosting.
    joined_here: AtomicUsize,
    central_role: AtomicU8,
    host_role: AtomicU8,
    stopping: AtomicBool,
    /// Woken by `stop`, so the host half can put its advert away instead of being cut off mid air.
    halt: Notify,
    /// Links to connected hosts, for the writer task. `tokio::sync::Mutex` because it is taken
    /// across an await.
    links: tokio::sync::Mutex<HashMap<String, CentralLink>>,
    /// Peripherals a link task is already dealing with, so the sweep does not start a second one.
    attached: Mutex<HashSet<String>>,
    /// Per link tasks, which come and go as devices arrive. Held so `stop` can end the ones that
    /// are parked on a notification stream and will never see the flag.
    children: Mutex<Vec<JoinHandle<()>>>,
    to_central: UnboundedSender<Frames>,
    to_host: UnboundedSender<Frames>,
}

impl Shared {
    fn stopping(&self) -> bool {
        self.stopping.load(Ordering::Relaxed)
    }

    fn set_central_role(&self, role: u8) {
        if self.central_role.swap(role, Ordering::Relaxed) != role {
            self.hub.peers_changed();
        }
    }

    fn set_host_role(&self, role: u8) {
        if self.host_role.swap(role, Ordering::Relaxed) != role {
            self.hub.peers_changed();
        }
    }

    /// Keeps the child task list from growing for the length of a run. A show can see dozens of
    /// devices come and go, and each one leaves a finished handle behind.
    fn remember_child(&self, task: JoinHandle<()>) {
        let mut children = guard(&self.children);
        children.retain(|held| !held.is_finished());
        children.push(task);
    }
}

/// A host this device has joined, and the characteristic to write to on it.
#[derive(Clone)]
struct CentralLink {
    peripheral: Peripheral,
    inbox: Characteristic,
    /// Sticky once a write without response has been refused. Without it every frame pays for the
    /// same failure again, which on a slow link is the difference between a cue landing and a cue
    /// arriving after the actor has already said the line.
    needs_response: Arc<AtomicBool>,
}

pub struct BlePlane {
    shared: Arc<Shared>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
    /// Kept apart from the rest because it is the one task worth winding down rather than aborting.
    host_task: Mutex<Option<JoinHandle<()>>>,
    /// Only set when this plane had to build its own runtime.
    runtime: Mutex<Option<Runtime>>,
}

/// Bring up whichever halves of the radio this device has.
///
/// Fails only if there is no way to run a task at all. Everything else, no adapter, no permission,
/// Bluetooth switched off, no peripheral role on this platform, is reported through `detail()` and
/// retried in the background, because a show that can still reach one device over Bluetooth is
/// worth having and the operator can see what is and is not working.
pub fn start(show: &str, device: &str, hub: Arc<Hub>) -> anyhow::Result<Arc<BlePlane>> {
    // Tauri already runs a tokio runtime, but `start` is also called from tests and from tooling
    // that does not, and `tokio::spawn` panics outside one. Borrow the ambient runtime when there
    // is one so the whole app shares a thread pool; build a small one when there is not.
    let (owned, rt) = match Handle::try_current() {
        Ok(handle) => (None, handle),
        Err(_) => {
            let runtime = Builder::new_multi_thread()
                .enable_all()
                .worker_threads(2)
                .thread_name("cueflow-ble")
                .build()
                .map_err(|error| {
                    anyhow!("CueFlow could not start its Bluetooth worker ({error}). Restart the app; the show can still run over Wi-Fi in the meantime.")
                })?;
            let handle = runtime.handle().clone();
            (Some(runtime), handle)
        }
    };

    let (to_central, from_hub_central) = unbounded_channel::<Frames>();
    let (to_host, from_hub_host) = unbounded_channel::<Frames>();

    // Seeded rather than started at zero. Two devices powered on together would otherwise both call
    // their first message id 1, and the far end dedups on that id.
    let seed = Uuid::new_v4().as_u128() as u16;

    let shared = Arc::new(Shared {
        hub,
        show: show.to_string(),
        device: device.to_string(),
        rt: rt.clone(),
        ids: Mutex::new(MessageIds::new(seed)),
        echoes: Mutex::new(Echoes::new()),
        hosts: AtomicUsize::new(0),
        joined_here: AtomicUsize::new(0),
        central_role: AtomicU8::new(ROLE_STARTING),
        host_role: AtomicU8::new(ROLE_STARTING),
        stopping: AtomicBool::new(false),
        halt: Notify::new(),
        links: tokio::sync::Mutex::new(HashMap::new()),
        attached: Mutex::new(HashSet::new()),
        children: Mutex::new(Vec::new()),
        to_central,
        to_host,
    });

    let tasks = vec![
        rt.spawn(central_discovery(Arc::clone(&shared))),
        rt.spawn(central_writer(Arc::clone(&shared), from_hub_central)),
    ];
    let host_task = host::spawn(Arc::clone(&shared), from_hub_host);

    info!("Bluetooth starting for show {show} as {device}");

    Ok(Arc::new(BlePlane {
        shared,
        tasks: Mutex::new(tasks),
        host_task: Mutex::new(host_task),
        runtime: Mutex::new(owned),
    }))
}

impl Plane for BlePlane {
    fn id(&self) -> &'static str {
        BLE
    }

    fn send(&self, body: Arc<Vec<u8>>, ttl: u8) {
        // Remembered before it goes out, so the copy that comes straight back off a peer that
        // relayed it is recognised as this device's own and not relayed a second time.
        guard(&self.shared.echoes).first(mark_of(&body));
        let msg_id = guard(&self.shared.ids).next();
        put_on_air(&self.shared, &body, msg_id, ttl);
    }

    fn peers(&self) -> usize {
        self.shared.hosts.load(Ordering::Relaxed) + self.shared.joined_here.load(Ordering::Relaxed)
    }

    fn detail(&self) -> String {
        status_line(
            self.shared.central_role.load(Ordering::Relaxed),
            self.shared.host_role.load(Ordering::Relaxed),
            self.shared.hosts.load(Ordering::Relaxed),
            self.shared.joined_here.load(Ordering::Relaxed),
        )
    }

    fn stop(&self) {
        // `swap` rather than a load then a store, so two threads calling stop at once cannot both
        // get past here and both drain the task list.
        if self.shared.stopping.swap(true, Ordering::SeqCst) {
            return;
        }
        self.shared.halt.notify_waiters();

        // The host half is asked to stop advertising and then taken out anyway. Waiting for it here
        // would block the caller on a radio, and `stop` is called from the window's own thread.
        if let Some(host) = guard(&self.host_task).take() {
            self.shared.rt.spawn(async move {
                tokio::time::sleep(STOP_GRACE).await;
                host.abort();
            });
        }
        for task in guard(&self.tasks).drain(..) {
            task.abort();
        }
        for task in guard(&self.shared.children).drain(..) {
            task.abort();
        }
    }
}

impl Drop for BlePlane {
    fn drop(&mut self) {
        self.stop();
        // `shutdown_background` rather than dropping the runtime, which blocks until every task has
        // ended and panics outright if it happens on a runtime thread.
        if let Some(runtime) = guard(&self.runtime).take() {
            runtime.shutdown_background();
        }
    }
}

/// What the status panel says about the Bluetooth half.
///
/// Pure so it can be tested, and worded so a technician can act on it: "joining only" tells them to
/// put a laptop in the room, which is something they can actually do.
fn status_line(central: u8, host: u8, hosts: usize, joined_here: usize) -> String {
    let mut parts: Vec<String> = Vec::new();
    match (central, host) {
        (ROLE_RUNNING, ROLE_RUNNING) => parts.push("hosting and joining".into()),
        (ROLE_RUNNING, ROLE_OFF) => parts.push("joining only, this device cannot host".into()),
        (ROLE_OFF, ROLE_RUNNING) => parts.push("hosting only, this device cannot join a host".into()),
        (ROLE_OFF, ROLE_OFF) => {
            return "Bluetooth is not running on this device. Check it is switched on.".into()
        }
        _ => parts.push("starting".into()),
    }
    if hosts > 0 {
        parts.push(format!("{hosts} linked"));
    }
    if joined_here > 0 {
        parts.push(format!("{joined_here} joined here"));
    }
    parts.join(", ")
}

/// Cut a message up and hand it to both roles.
///
/// The same frames go to both, because a device is usually reaching different peers with each: the
/// phones joined here hear it as a notification, the host this device joined hears it as a write.
fn put_on_air(shared: &Shared, body: &[u8], msg_id: u16, ttl: u8) {
    let frames = match chunk(body, msg_id, ttl, BLE_FRAME) {
        Ok(frames) => Arc::new(frames),
        Err(ChunkError::TooManyFrames) => {
            warn!("This message is too large to send over Bluetooth. Send the script over Wi-Fi or with a cable instead.");
            return;
        }
        Err(ChunkError::FrameTooSmall) => {
            // Unreachable with BLE_FRAME, which is 244. Here so a future frame size change is a log
            // line rather than a silently dropped cue.
            warn!("CueFlow asked for a Bluetooth frame too small to hold a message header. This is a bug in CueFlow, not a fault with the radio.");
            return;
        }
    };
    // A closed channel means that role is not running. Nothing to report: `detail()` already says so
    // and the other role may well have carried the message.
    let _ = shared.to_central.send(Arc::clone(&frames));
    let _ = shared.to_host.send(frames);
}

/// The frames to put back on the radio for a message just heard, or `None` to stop here.
///
/// The original message id is kept rather than a fresh one. The far end dedups on that id, and a
/// relay that renumbered would look like a new message to every device it reached, which in a room
/// where two devices can hear each other is how one cue becomes a broadcast storm.
fn onward_frames(msg: &Message) -> Option<Vec<Vec<u8>>> {
    let ttl = relay_ttl(msg.ttl)?;
    match chunk(&msg.body, msg.msg_id, ttl, BLE_FRAME) {
        Ok(frames) => Some(frames),
        Err(error) => {
            warn!("could not pass a message on over Bluetooth: {error:?}");
            None
        }
    }
}

/// One whole message, from either role.
///
/// Unlike Wi-Fi, where every device on the network hears every broadcast, Bluetooth links are point
/// to point: a phone in the wings and a laptop in the booth both joined this device and neither can
/// hear the other. So this plane relays inside itself, which the hub does not do for it; the hub
/// only ever crosses a message to the *other* planes.
fn take_inbound(shared: &Shared, msg: Message) {
    // Passed on before it is handed up. Both are cheap, and the device waiting on the next hop is
    // waiting on a radio, while the window is a function call away.
    //
    // Handed up either way, though. A message this device has already relayed can still be one the
    // hub has not seen, and a cue that is not shown to the operator because it was relayed a moment
    // ago is the worst failure this file could have.
    //
    // Its own statement, so the lock is not still held while the message is cut into frames.
    let fresh = guard(&shared.echoes).first(mark_of(&msg.body));
    if fresh {
        if let Some(frames) = onward_frames(&msg) {
            let frames = Arc::new(frames);
            let _ = shared.to_central.send(Arc::clone(&frames));
            let _ = shared.to_host.send(frames);
        }
    }
    shared.hub.inbound(BLE, msg.body, msg.ttl);
}

// ---------------------------------------------------------------------------------------------
// Central: scanning, connecting, subscribing. Every platform, Android included.
// ---------------------------------------------------------------------------------------------

/// Finds hosts and keeps finding them.
///
/// This loop never gives up while the show is running. A Bluetooth adapter can appear halfway
/// through a performance, because somebody plugged a dongle in or switched the radio back on, and
/// asking the operator to rejoin the show to pick that up is asking them to take their hands off the
/// book during a cue sequence.
async fn central_discovery(shared: Arc<Shared>) {
    let manager = match Manager::new().await {
        Ok(manager) => manager,
        Err(error) => {
            warn!("This device cannot scan for Bluetooth shows ({error}). It can still take part over Wi-Fi, and phones can join a laptop instead.");
            shared.set_central_role(ROLE_OFF);
            return;
        }
    };

    while !shared.stopping() {
        match first_adapter(&manager).await {
            Some(adapter) => scan_until_it_stops(&shared, adapter).await,
            None => {
                shared.set_central_role(ROLE_OFF);
                debug!("no Bluetooth adapter yet, will look again");
            }
        }
        if shared.stopping() {
            return;
        }
        tokio::time::sleep(RADIO_RETRY).await;
    }
}

/// The first adapter that answers, or nothing.
///
/// `adapters()` returns an empty list rather than an error when the radio is off, so "no adapter"
/// and "adapter refused" are the same case to the caller: wait and ask again.
async fn first_adapter(manager: &Manager) -> Option<Adapter> {
    match manager.adapters().await {
        Ok(found) => found.into_iter().next(),
        Err(error) => {
            debug!("could not list Bluetooth adapters: {error}");
            None
        }
    }
}

async fn scan_until_it_stops(shared: &Arc<Shared>, adapter: Adapter) {
    let mut since_rescan = RESCAN_AFTER; // force a scan on the first pass through

    while !shared.stopping() {
        if since_rescan >= RESCAN_AFTER {
            // Filtered to the show service so the sweep is not wading through every fitness tracker
            // in the building. Some backends ignore the filter, which is why the sweep checks the
            // advertised services again below.
            match adapter.start_scan(ScanFilter { services: vec![SHOW_SERVICE] }).await {
                Ok(()) => {
                    shared.set_central_role(ROLE_RUNNING);
                    since_rescan = 0;
                }
                Err(error) => {
                    warn!("Bluetooth would not start scanning ({error}). Check Bluetooth is switched on and that CueFlow is allowed to use it.");
                    shared.set_central_role(ROLE_OFF);
                    return;
                }
            }
        }

        match adapter.peripherals().await {
            Ok(found) => {
                for peripheral in found {
                    consider(shared, peripheral).await;
                }
            }
            // Not fatal: the adapter may be busy. The next sweep asks again.
            Err(error) => debug!("could not read what the adapter has seen: {error}"),
        }

        tokio::time::sleep(SWEEP).await;
        since_rescan += 1;
    }
}

/// One device the adapter has seen. Connect to it if it is hosting our show and we are not already
/// dealing with it.
async fn consider(shared: &Arc<Shared>, peripheral: Peripheral) {
    // `PeripheralId` is a different type on every backend and only Debug is guaranteed across all of
    // them, so the identity used here is its Debug text. It is stable for the life of a scan, which
    // is all this needs it to be.
    let key = format!("{:?}", peripheral.id());
    if guard(&shared.attached).contains(&key) {
        return;
    }

    let props = match peripheral.properties().await {
        Ok(Some(props)) => props,
        // No properties yet means the advert has not been parsed. It will be on a later sweep.
        Ok(None) => return,
        Err(error) => {
            debug!("could not read a device's advert: {error}");
            return;
        }
    };
    if !props.services.contains(&SHOW_SERVICE) {
        return;
    }
    if different_show(props.local_name.as_deref(), &shared.show) {
        debug!("ignoring {key}, it is hosting another show");
        return;
    }

    guard(&shared.attached).insert(key.clone());
    let task = shared.rt.spawn(central_link(Arc::clone(shared), peripheral, key));
    shared.remember_child(task);
}

/// One link to one host, from connect to disconnect, plus the tidying up afterwards.
async fn central_link(shared: Arc<Shared>, peripheral: Peripheral, key: String) {
    if let Err(reason) = hold_link(&shared, &peripheral, &key).await {
        // Info rather than warn: a link that drops because somebody walked through a fire door is
        // the normal life of a Bluetooth show, and the sweep will pick it up again.
        info!("the Bluetooth link to {key} ended: {reason}");
    }

    {
        let mut links = shared.links.lock().await;
        links.remove(&key);
        shared.hosts.store(links.len(), Ordering::Relaxed);
    }
    guard(&shared.attached).remove(&key);
    // Best effort. If the peer is already gone this fails, and that is the case we are in anyway.
    let _ = peripheral.disconnect().await;
    shared.hub.peers_changed();
}

async fn hold_link(
    shared: &Arc<Shared>,
    peripheral: &Peripheral,
    key: &str,
) -> anyhow::Result<()> {
    tokio::time::timeout(CONNECT_WAIT, peripheral.connect())
        .await
        .map_err(|_| anyhow!("a device advertising this show did not answer in time"))??;
    tokio::time::timeout(DISCOVER_WAIT, peripheral.discover_services())
        .await
        .map_err(|_| anyhow!("a device answered but never listed what it offers"))??;

    let characteristics = peripheral.characteristics();
    let inbox = characteristics
        .iter()
        .find(|found| found.uuid == SHOW_INBOX)
        .cloned()
        .ok_or_else(|| anyhow!("that device advertises a CueFlow show but has no inbox to write to; it may be running an older version of CueFlow"))?;
    let outbox = characteristics
        .iter()
        .find(|found| found.uuid == SHOW_OUTBOX)
        .cloned()
        .ok_or_else(|| anyhow!("that device advertises a CueFlow show but never sends anything back; it may be running an older version of CueFlow"))?;
    if !outbox.properties.contains(CharPropFlags::NOTIFY) {
        return Err(anyhow!("that device's outbox cannot notify, so nothing it says would arrive"));
    }

    // The stream is taken before subscribing, so a notification sent the instant the subscription
    // lands is not dropped on the floor between the two calls.
    let mut notifications = peripheral.notifications().await?;
    peripheral.subscribe(&outbox).await?;

    let link = CentralLink {
        peripheral: peripheral.clone(),
        inbox: inbox.clone(),
        // Start optimistic only when the peer says it can take a write without a response. Without
        // response is several times faster, and it is what a cue wants.
        needs_response: Arc::new(AtomicBool::new(
            !inbox.properties.contains(CharPropFlags::WRITE_WITHOUT_RESPONSE),
        )),
    };
    {
        let mut links = shared.links.lock().await;
        links.insert(key.to_string(), link);
        shared.hosts.store(links.len(), Ordering::Relaxed);
    }
    shared.hub.peers_changed();
    info!("joined a Bluetooth show host, {} is in the room", shared.device);

    let base = Instant::now();
    let mut join = Reassembler::new(PENDING_LIMIT, EXPIRE_MS);
    let mut liveness = tokio::time::interval(LIVENESS);

    loop {
        tokio::select! {
            heard = notifications.next() => match heard {
                Some(note) => {
                    // The stream carries every subscribed characteristic on this peripheral, so the
                    // uuid has to be checked rather than assumed.
                    if note.uuid == SHOW_OUTBOX {
                        if let Some(msg) = join.accept(&note.value, ms_since(base)) {
                            take_inbound(shared, msg);
                        }
                    }
                }
                None => return Err(anyhow!("the host stopped sending")),
            },
            _ = liveness.tick() => {
                if shared.stopping() {
                    return Ok(());
                }
                // Some backends leave the notification stream open forever after the peer has gone.
                if !peripheral.is_connected().await.unwrap_or(false) {
                    return Err(anyhow!("the host went out of range"));
                }
            }
        }
    }
}

/// Writes whatever the plane wants said to every host this device has joined.
///
/// One task rather than one per link, because a message goes to all of them and the set changes
/// while it is being sent.
async fn central_writer(shared: Arc<Shared>, mut from_hub: UnboundedReceiver<Frames>) {
    while let Some(frames) = from_hub.recv().await {
        if shared.stopping() {
            return;
        }
        // Copied out of the lock rather than written under it, so a slow radio does not stop a new
        // device being registered for the length of a script transfer.
        let links: Vec<CentralLink> = shared.links.lock().await.values().cloned().collect();
        if links.is_empty() {
            continue;
        }
        // In parallel, because these are separate radios' worth of latency and one peer at the far
        // end of the building should not delay the one standing next to the desk.
        let writes = links.iter().map(|link| write_frames(link, &frames));
        futures::future::join_all(writes).await;
    }
}

/// Every frame of one message to one host.
///
/// Stops at the first frame that will not go. The rest of the message would only be a partial one
/// the far end holds until it expires.
async fn write_frames(link: &CentralLink, frames: &[Vec<u8>]) {
    for frame in frames {
        if !link.needs_response.load(Ordering::Relaxed) {
            match link.peripheral.write(&link.inbox, frame, WriteType::WithoutResponse).await {
                Ok(()) => continue,
                // Not every stack will take a write without a response even when the characteristic
                // claims it can, so fall back rather than giving up on the peer.
                Err(error) => debug!("a fast Bluetooth write was refused, trying the slow one: {error}"),
            }
        }
        match link.peripheral.write(&link.inbox, frame, WriteType::WithResponse).await {
            Ok(()) => link.needs_response.store(true, Ordering::Relaxed),
            Err(error) => {
                warn!("could not send over Bluetooth to a joined host ({error}). Move the devices closer together; CueFlow will keep trying.");
                return;
            }
        }
    }
}

/// The advert prefix, and how much of the show name fits after it.
///
/// A BLE advertising packet is 31 bytes and the 128 bit service UUID takes 18 of them, so the name
/// is the first thing a stack truncates or drops entirely. Short prefix, short budget.
const NAME_PREFIX: &str = "CF:";
const NAME_BYTES: usize = 20;

/// What this device calls itself on the air.
///
/// Truncated on a character boundary, because a show called "Père Ubu" cut mid character is not a
/// string and some stacks refuse the whole advert rather than the bad byte.
fn advert_name(show: &str) -> String {
    let mut name = String::from(NAME_PREFIX);
    for ch in show.chars() {
        if name.len() + ch.len_utf8() > NAME_BYTES {
            break;
        }
        name.push(ch);
    }
    name
}

/// Whether a device advertising `advertised` is hosting some other show.
///
/// The service UUID is the same for every CueFlow show, so two productions in one building would
/// otherwise join each other's mesh. The name is the only thing separating them, and it is not
/// reliable: it may be absent, and either side may have had it cut short by a different stack. So a
/// missing name is never a mismatch, and two names match when either is a prefix of the other.
/// Being slightly too willing to join is the right way to be wrong here; refusing to join the right
/// show because an advert was clipped is not recoverable by anyone in the building.
fn different_show(advertised: Option<&str>, show: &str) -> bool {
    let Some(name) = advertised else {
        return false;
    };
    let Some(theirs) = name.strip_prefix(NAME_PREFIX) else {
        return false;
    };
    let ours = advert_name(show);
    let ours = &ours[NAME_PREFIX.len()..];
    !(ours.starts_with(theirs) || theirs.starts_with(ours))
}

// ---------------------------------------------------------------------------------------------
// Peripheral: advertising and hosting the GATT server. Desktop only.
// ---------------------------------------------------------------------------------------------
//
// `ble_peripheral` is set by `build.rs` from `CARGO_CFG_TARGET_OS`, not by a cargo feature. A
// feature would have to be switched off by hand for the Android build, and the first time somebody
// forgot, the Android build would break for a reason unrelated to their change. The target list is
// spelled out alongside it so that a build with no `build.rs` run still keeps the host role on a
// laptop; losing it silently would look exactly like a working build that no phone can ever find.

#[cfg(any(
    ble_peripheral,
    target_os = "windows",
    target_os = "macos",
    target_os = "linux"
))]
mod host {
    use std::collections::{HashMap, HashSet};
    use std::sync::atomic::Ordering;
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use ble_peripheral_rust::gatt::characteristic::Characteristic;
    use ble_peripheral_rust::gatt::peripheral_event::{
        PeripheralEvent, ReadRequestResponse, RequestResponse, WriteRequestResponse,
    };
    use ble_peripheral_rust::gatt::properties::{AttributePermission, CharacteristicProperty};
    use ble_peripheral_rust::gatt::service::Service;
    use ble_peripheral_rust::{Peripheral as GattServer, PeripheralImpl};
    use cueflow_mesh::Reassembler;
    use tokio::sync::mpsc::UnboundedReceiver;
    use tokio::task::JoinHandle;
    use tracing::{debug, info, warn};

    use super::{
        advert_name, ms_since, take_inbound, Frames, Shared, EXPIRE_MS, PENDING_LIMIT, ROLE_OFF,
        ROLE_RUNNING, SHOW_INBOX, SHOW_OUTBOX, SHOW_SERVICE,
    };

    /// Room for a burst of writes while this task is busy notifying. A script arriving from one
    /// phone is a few hundred frames.
    const EVENT_QUEUE: usize = 512;
    /// How long to wait for the radio to report itself powered before giving up on hosting.
    const POWER_TRIES: u32 = 40;
    const POWER_WAIT: Duration = Duration::from_millis(250);
    /// Reassemblers held for devices that have written at least once. Capped because a busy foyer
    /// produces a lot of one time clients.
    const CLIENT_LIMIT: usize = 16;

    pub(super) fn spawn(shared: Arc<Shared>, from_hub: UnboundedReceiver<Frames>) -> Option<JoinHandle<()>> {
        let rt = shared.rt.clone();
        Some(rt.spawn(run(shared, from_hub)))
    }

    async fn run(shared: Arc<Shared>, mut from_hub: UnboundedReceiver<Frames>) {
        let (events_tx, mut events) = tokio::sync::mpsc::channel::<PeripheralEvent>(EVENT_QUEUE);

        // These errors are formatted rather than returned. `ble-peripheral-rust` does not promise a
        // Send + Sync error type across its three backends, and an error that cannot cross a task
        // boundary is not worth reshaping the whole function around; the message is what matters.
        let mut server = match GattServer::new(events_tx).await {
            Ok(server) => server,
            Err(error) => {
                warn!("This device cannot host a Bluetooth show ({error}). It can still join one, and phones can join a different laptop.");
                shared.set_host_role(ROLE_OFF);
                return;
            }
        };

        let mut powered = false;
        for _ in 0..POWER_TRIES {
            if shared.stopping() {
                return;
            }
            match server.is_powered().await {
                Ok(true) => {
                    powered = true;
                    break;
                }
                Ok(false) => {}
                Err(error) => debug!("could not read the Bluetooth radio's state: {error}"),
            }
            tokio::time::sleep(POWER_WAIT).await;
        }
        if !powered {
            warn!("Bluetooth is switched off on this device, so it cannot host the show. Switch Bluetooth on and join the show again.");
            shared.set_host_role(ROLE_OFF);
            return;
        }

        let service = Service {
            uuid: SHOW_SERVICE,
            primary: true,
            characteristics: vec![
                // Inbox: both write kinds, because a joiner prefers write without response for speed
                // and has to be able to fall back when its stack refuses.
                Characteristic {
                    uuid: SHOW_INBOX,
                    properties: vec![
                        CharacteristicProperty::Write,
                        CharacteristicProperty::WriteWithoutResponse,
                    ],
                    permissions: vec![AttributePermission::Writeable],
                    value: None,
                    descriptors: vec![],
                },
                // Outbox: notify only. It is a stream of frames, not a value, so there is nothing
                // useful to read from it.
                Characteristic {
                    uuid: SHOW_OUTBOX,
                    properties: vec![CharacteristicProperty::Notify],
                    permissions: vec![AttributePermission::Readable],
                    value: None,
                    descriptors: vec![],
                },
            ],
        };
        if let Err(error) = server.add_service(&service).await {
            warn!("This device could not set up the Bluetooth show service ({error}). It can still join a show hosted elsewhere.");
            shared.set_host_role(ROLE_OFF);
            return;
        }

        let name = advert_name(&shared.show);
        if let Err(error) = server.start_advertising(&name, &[SHOW_SERVICE]).await {
            warn!("This device could not start advertising the show over Bluetooth ({error}). Nothing will be able to find it; it can still join a show hosted elsewhere.");
            shared.set_host_role(ROLE_OFF);
            return;
        }
        shared.set_host_role(ROLE_RUNNING);
        info!("hosting the show over Bluetooth as {name}");

        let base = Instant::now();
        let mut subscribers: HashSet<String> = HashSet::new();
        let mut joins: HashMap<String, Reassembler> = HashMap::new();

        // Built once and held across the loop, not rebuilt per iteration. `notify_waiters` only
        // wakes waiters that have already registered, and a fresh `notified()` each time round
        // registers nothing until it is polled, so a stop landing between two iterations would be
        // missed and the advert would stay up until the watchdog cut the task off.
        let halt = shared.halt.notified();
        tokio::pin!(halt);

        loop {
            tokio::select! {
                // Asked to stop. Put the advert away first, so a phone looking for a host does not
                // keep finding a show that has already been closed.
                _ = &mut halt => {
                    let _ = server.stop_advertising().await;
                    shared.set_host_role(ROLE_OFF);
                    return;
                }
                event = events.recv() => match event {
                    Some(event) => handle(&shared, event, base, &mut subscribers, &mut joins),
                    None => {
                        warn!("The Bluetooth host stopped answering, so devices can no longer join this one. The show can still run over Wi-Fi.");
                        shared.set_host_role(ROLE_OFF);
                        return;
                    }
                },
                frames = from_hub.recv() => match frames {
                    Some(frames) => {
                        // Nothing subscribed means nothing would hear it, and a notify with no
                        // subscriber is a radio wakeup for no reason.
                        if subscribers.is_empty() {
                            continue;
                        }
                        for frame in frames.iter() {
                            if let Err(error) = server.update_characteristic(SHOW_OUTBOX, frame.clone()).await {
                                warn!("could not send over Bluetooth to a joined device ({error}). Move the devices closer together; CueFlow will keep trying.");
                                break;
                            }
                        }
                    }
                    None => return,
                },
            }
        }
    }

    /// One event from the GATT server.
    ///
    /// Deliberately not exhaustive. A later `ble-peripheral-rust` adding an event kind should not
    /// stop CueFlow building the night before a get in.
    fn handle(
        shared: &Arc<Shared>,
        event: PeripheralEvent,
        base: Instant,
        subscribers: &mut HashSet<String>,
        joins: &mut HashMap<String, Reassembler>,
    ) {
        match event {
            PeripheralEvent::StateUpdate { is_powered } => {
                if !is_powered {
                    warn!("Bluetooth was switched off on this device, so nothing can join it any more.");
                    shared.set_host_role(ROLE_OFF);
                    subscribers.clear();
                    shared.joined_here.store(0, Ordering::Relaxed);
                    shared.hub.peers_changed();
                }
            }

            PeripheralEvent::CharacteristicSubscriptionUpdate { request, subscribed } => {
                if request.characteristic != SHOW_OUTBOX {
                    return;
                }
                if subscribed {
                    subscribers.insert(request.client.clone());
                } else {
                    subscribers.remove(&request.client);
                    joins.remove(&request.client);
                }
                shared.joined_here.store(subscribers.len(), Ordering::Relaxed);
                shared.hub.peers_changed();
            }

            // Answered with nothing, but answered. A central that reads and is never replied to sits
            // waiting on the ATT timeout, and on some stacks that stalls the whole link, including
            // the notifications the show actually travels on.
            PeripheralEvent::ReadRequest { request, offset, responder } => {
                debug!("a device read {} at {offset}, which carries no value", request.characteristic);
                let _ = responder.send(ReadRequestResponse {
                    value: Vec::new(),
                    response: RequestResponse::Success,
                });
            }

            PeripheralEvent::WriteRequest { request, offset: _, value, responder } => {
                // Acknowledged before the frame is looked at. The central is holding its link open
                // until this lands, and reassembly is this device's problem, not its problem.
                let _ = responder.send(WriteRequestResponse { response: RequestResponse::Success });
                if request.characteristic != SHOW_INBOX {
                    return;
                }

                // One reassembler per client. Two phones can pick the same two byte message id
                // within a second of each other, and a shared one would splice their frames into a
                // message neither of them sent.
                if !joins.contains_key(&request.client) && joins.len() >= CLIENT_LIMIT {
                    // Oldest is not tracked, so drop an arbitrary one. At sixteen clients this is a
                    // foyer full of phones, not a show, and a dropped partial simply arrives again.
                    if let Some(evict) = joins.keys().next().cloned() {
                        joins.remove(&evict);
                    }
                }
                let join = joins
                    .entry(request.client.clone())
                    .or_insert_with(|| Reassembler::new(PENDING_LIMIT, EXPIRE_MS));
                if let Some(msg) = join.accept(&value, ms_since(base)) {
                    take_inbound(shared, msg);
                }
            }
        }
    }
}

#[cfg(not(any(
    ble_peripheral,
    target_os = "windows",
    target_os = "macos",
    target_os = "linux"
)))]
mod host {
    use std::sync::Arc;

    use tokio::sync::mpsc::UnboundedReceiver;
    use tokio::task::JoinHandle;
    use tracing::warn;

    use super::{Frames, Shared, ROLE_OFF};

    /// Android, and anything else with no peripheral role.
    ///
    /// `btleplug` cannot advertise on any platform, and Android's GATT server lives behind
    /// `android.bluetooth.BluetoothGattServer`, which needs a Kotlin Tauri plugin CueFlow has not
    /// written yet. Rather than pretend, this says so once in the log and leaves `detail()` telling
    /// the operator that this device joins but does not host. A phone that can join the laptop at
    /// the desk is in the show; a phone that refused to start Bluetooth at all is not.
    pub(super) fn spawn(shared: Arc<Shared>, from_hub: UnboundedReceiver<Frames>) -> Option<JoinHandle<()>> {
        // Dropped deliberately: closing the channel is what tells `put_on_air` this half is not
        // running, rather than queueing frames nobody will ever send.
        drop(from_hub);
        warn!("This device can join a Bluetooth show but cannot host one, because it has no way to advertise. Keep a laptop running CueFlow in the room and everything else will join it.");
        shared.set_host_role(ROLE_OFF);
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cueflow_mesh::{read_frame, DEFAULT_TTL};

    fn body(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    fn whole(frames: &[Vec<u8>]) -> Message {
        let mut join = Reassembler::new(PENDING_LIMIT, EXPIRE_MS);
        let mut out = None;
        for frame in frames {
            out = join.accept(frame, 0).or(out);
        }
        match out {
            Some(msg) => msg,
            None => panic!("the frames never made a whole message"),
        }
    }

    /// The round trip this plane is: cut up for the radio, put back together at the far end.
    #[test]
    fn a_message_survives_being_cut_up_for_the_radio() {
        let original = body(3_000);
        let frames = chunk(&original, 7, DEFAULT_TTL, BLE_FRAME).expect("a message this size chunks");
        assert!(frames.len() > 1, "3 kB does not fit in one BLE frame");
        let back = whole(&frames);
        assert_eq!(back.body, original);
        assert_eq!(back.msg_id, 7);
        assert_eq!(back.ttl, DEFAULT_TTL);
    }

    #[test]
    fn no_frame_is_larger_than_a_gatt_write() {
        for frame in chunk(&body(5_000), 1, DEFAULT_TTL, BLE_FRAME).expect("chunks") {
            assert!(frame.len() <= BLE_FRAME);
        }
    }

    /// The rule that stops two devices in range of each other passing one cue back and forth all
    /// night.
    #[test]
    fn a_message_at_its_last_hop_is_not_relayed() {
        let frames = chunk(&body(400), 12, 1, BLE_FRAME).expect("chunks");
        let arrived = whole(&frames);
        assert_eq!(arrived.ttl, 1);
        assert!(onward_frames(&arrived).is_none());
    }

    #[test]
    fn hops_count_down_and_then_stop() {
        assert_eq!(relay_ttl(DEFAULT_TTL), Some(3));
        assert_eq!(relay_ttl(2), Some(1));
        assert_eq!(relay_ttl(1), None);
        assert_eq!(relay_ttl(0), None);
    }

    /// A relay keeps the id and loses a hop. The id is what the far end dedups on, so renumbering
    /// here is how one cue would become a storm.
    #[test]
    fn a_relayed_message_keeps_its_id_and_loses_a_hop() {
        let arrived = whole(&chunk(&body(400), 0x1234, 4, BLE_FRAME).expect("chunks"));
        let onward = onward_frames(&arrived).expect("a message with hops left is passed on");
        for frame in &onward {
            let head = read_frame(frame).expect("a frame this file wrote is a frame it can read");
            assert_eq!(head.msg_id, 0x1234);
            assert_eq!(head.ttl, 3);
        }
        assert_eq!(whole(&onward).body, arrived.body);
    }

    /// The other half of the contract with `src/lib/transports/ble.ts`. If these ever disagree, the
    /// host advertises a service the page cannot find.
    #[test]
    fn the_three_uuids_are_the_ones_the_page_uses() {
        let parse = |text: &str| Uuid::parse_str(text).expect("a uuid written out in this file");
        assert_eq!(parse(SHOW_SERVICE_TEXT), SHOW_SERVICE);
        assert_eq!(parse(SHOW_INBOX_TEXT), SHOW_INBOX);
        assert_eq!(parse(SHOW_OUTBOX_TEXT), SHOW_OUTBOX);
        assert_ne!(SHOW_INBOX, SHOW_OUTBOX);
        assert_ne!(SHOW_SERVICE, SHOW_INBOX);
    }

    #[test]
    fn the_advertised_name_fits_in_an_advert_and_never_splits_a_character() {
        let name = advert_name("Père Ubu at the Théâtre des Pantins, 1896");
        assert!(name.len() <= NAME_BYTES);
        assert!(name.starts_with(NAME_PREFIX));
        // The test is that this is a string at all: a cut mid character would not have compiled a
        // valid `String`, and some stacks refuse the whole advert rather than the bad byte.
        assert!(name.chars().count() > NAME_PREFIX.chars().count());
    }

    #[test]
    fn a_missing_or_clipped_advert_is_not_treated_as_another_show() {
        // No name at all: plenty of stacks drop it to fit the service UUID.
        assert!(!different_show(None, "Macbeth"));
        // Somebody else's device entirely, not CueFlow's prefix.
        assert!(!different_show(Some("Fitness Band 3"), "Macbeth"));
        // Ours, clipped short by the other stack.
        assert!(!different_show(Some("CF:Mac"), "Macbeth"));
        assert!(!different_show(Some("CF:Macbeth"), "Macbeth"));
    }

    #[test]
    fn another_production_in_the_same_building_is_left_alone() {
        assert!(different_show(Some("CF:Hamlet"), "Macbeth"));
        assert!(different_show(Some("CF:Macbett"), "Macbeth"));
    }

    /// The gate that stops three phones on one host turning every cue into a round of writes.
    #[test]
    fn a_message_is_only_put_back_on_the_air_once() {
        let mut echoes = Echoes::new();
        let cue = mark_of(b"go on 12");
        assert!(echoes.first(cue));
        assert!(!echoes.first(cue), "the same cue heard again is not relayed again");
        assert!(echoes.first(mark_of(b"go on 13")), "a different cue still goes");
    }

    #[test]
    fn the_echo_gate_forgets_rather_than_growing_forever() {
        let mut echoes = Echoes::new();
        let first = mark_of(b"standby");
        assert!(echoes.first(first));
        for filler in 0..ECHOES as u64 {
            // Offset past zero, which is the empty ring's own value.
            assert!(echoes.first(filler + 1));
        }
        assert!(echoes.first(first), "the oldest mark has been pushed out, so it relays again");
    }

    #[test]
    fn two_different_messages_do_not_share_a_mark() {
        assert_ne!(mark_of(b"go on 12"), mark_of(b"go on 13"));
        assert_eq!(mark_of(b"standby"), mark_of(b"standby"));
    }

    #[test]
    fn the_status_line_says_which_half_is_running() {
        assert_eq!(status_line(ROLE_RUNNING, ROLE_RUNNING, 2, 1), "hosting and joining, 2 linked, 1 joined here");
        assert_eq!(status_line(ROLE_RUNNING, ROLE_OFF, 0, 0), "joining only, this device cannot host");
        assert_eq!(status_line(ROLE_OFF, ROLE_RUNNING, 0, 3), "hosting only, this device cannot join a host, 3 joined here");
        assert_eq!(status_line(ROLE_STARTING, ROLE_STARTING, 0, 0), "starting");
        assert!(status_line(ROLE_OFF, ROLE_OFF, 0, 0).contains("not running"));
    }
}
