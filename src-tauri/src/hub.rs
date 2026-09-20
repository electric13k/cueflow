//! Where the two radios meet.
//!
//! CueFlow's offline show runs over two carriers at once, and neither is enough on its own. Wi-Fi
//! carries a whole script in a blink but needs every device on one network, which a touring venue
//! does not reliably have. Bluetooth reaches devices that share no network at all but moves a few
//! kilobytes a second, so a script over it is a minute of waiting. Running both and letting each
//! message take whichever is up is the only shape that survives a real venue.
//!
//! The hub is what makes that one mesh rather than two. Every plane hands what it hears to
//! `inbound`, and the hub does three things with it: drops it if the room has already seen it,
//! gives it to the webview, and re-floods it to the *other* planes so a phone on Bluetooth hears a
//! cue that was sent over Wi-Fi. That crossing is the whole point; without it a device on the wrong
//! radio is simply not in the show.
//!
//! Dedup lives here and not in the planes because a message can arrive twice by two different
//! routes, which is not a bug, it is the mesh working. The router in `src/lib/transport.ts` has its
//! own gate for the same reason; this one exists so a duplicate is not re-flooded and does not turn
//! a four device room into a broadcast storm.

use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

/// One carrier of show bytes. LAN and BLE each implement this.
pub trait Plane: Send + Sync {
    fn id(&self) -> &'static str;
    /// Flood one message to every peer this plane reaches. `ttl` is hops remaining (>= 1).
    fn send(&self, body: Arc<Vec<u8>>, ttl: u8);
    /// Peers currently attached.
    fn peers(&self) -> usize;
    /// Extra detail for the status panel, e.g. "port 7377". Empty string if none.
    fn detail(&self) -> String {
        String::new()
    }
    /// Stop everything. Must be idempotent and must not block for long.
    fn stop(&self);
}

/// How far a message travels before it is dropped: desk, wings, circle, back of house.
/// Taken from the wire format crate so the three implementations cannot drift apart.
pub const DEFAULT_TTL: u8 = cueflow_mesh::DEFAULT_TTL;

/// How many recent messages the gate remembers.
///
/// A show generates a few messages a second at its busiest, so a thousand is several minutes of
/// history. That is far longer than a message can still be bouncing around a room, and small enough
/// that the set costs nothing.
const SEEN_LIMIT: usize = 1024;

/// What the webview is told about the mesh.
#[derive(Clone, serde::Serialize)]
pub struct PlaneStatus {
    pub id: String,
    pub peers: usize,
    pub detail: String,
}

#[derive(Clone, serde::Serialize)]
pub struct MeshStatus {
    pub planes: Vec<PlaneStatus>,
    pub peers: usize,
}

/// Remembers what the room has already heard, so a message arriving by two routes is acted on once
/// and relayed once.
struct Seen {
    marks: HashSet<u64>,
    order: VecDeque<u64>,
}

impl Seen {
    fn new() -> Self {
        Self { marks: HashSet::new(), order: VecDeque::new() }
    }

    /// True the first time these bytes are offered, false afterwards.
    fn first(&mut self, mark: u64) -> bool {
        if !self.marks.insert(mark) {
            return false;
        }
        self.order.push_back(mark);
        if self.order.len() > SEEN_LIMIT {
            if let Some(old) = self.order.pop_front() {
                self.marks.remove(&old);
            }
        }
        true
    }
}

/// FNV-1a. Not a security boundary: this only has to tell two messages apart within one show, and
/// hashing every frame on a phone radio with something cryptographic would cost more than it buys.
fn mark_of(body: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in body {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

pub struct Hub {
    app: AppHandle,
    planes: Mutex<Vec<Arc<dyn Plane>>>,
    seen: Mutex<Seen>,
}

impl Hub {
    pub fn new(app: AppHandle) -> Arc<Self> {
        Arc::new(Self { app, planes: Mutex::new(Vec::new()), seen: Mutex::new(Seen::new()) })
    }

    /// Planes attach after the hub exists, because each one needs an `Arc<Hub>` to report to.
    pub fn attach(&self, plane: Arc<dyn Plane>) {
        self.planes.lock().unwrap().push(plane);
    }

    /// The planes, copied out of the lock.
    ///
    /// Copied rather than held, because `send` on a plane takes that plane's own lock and calling
    /// into it while still holding the hub's would be a lock order waiting to bite the first time a
    /// plane reported inbound from inside a send.
    fn snapshot(&self) -> Vec<Arc<dyn Plane>> {
        self.planes.lock().unwrap().clone()
    }

    pub fn status(&self) -> MeshStatus {
        let planes: Vec<PlaneStatus> = self
            .snapshot()
            .iter()
            .map(|plane| PlaneStatus {
                id: plane.id().to_string(),
                peers: plane.peers(),
                detail: plane.detail(),
            })
            .collect();
        let peers = planes.iter().map(|plane| plane.peers).sum();
        MeshStatus { planes, peers }
    }

    /// A plane calls this for every message it takes off its wire.
    pub fn inbound(&self, from_plane: &'static str, body: Vec<u8>, ttl: u8) {
        if !self.seen.lock().unwrap().first(mark_of(&body)) {
            return;
        }

        match std::str::from_utf8(&body) {
            Ok(text) => {
                // Failing to emit means the window has gone. Nothing to do about that here, and the
                // relay below still matters: this device may be the only thing joining the wings to
                // the booth.
                if let Err(error) = self.app.emit("mesh://envelope", text) {
                    tracing::warn!("could not hand a message to the window: {error}");
                }
            }
            Err(_) => tracing::warn!("dropped a message from {from_plane} that was not text"),
        }

        // Relaying is what crosses the radios. A message that arrived over Wi-Fi goes out over
        // Bluetooth and the other way round, so the phone with no network and the laptop with no
        // pairing are in the same show. The hop count is what stops that being a loop.
        let Some(onward) = ttl.checked_sub(1).filter(|left| *left >= 1) else {
            return;
        };
        let shared = Arc::new(body);
        for plane in self.snapshot() {
            if plane.id() != from_plane {
                plane.send(Arc::clone(&shared), onward);
            }
        }
    }

    /// A plane calls this when its peer count changes.
    pub fn peers_changed(&self) {
        if let Err(error) = self.app.emit("mesh://status", self.status()) {
            tracing::debug!("no window to tell about the peer count: {error}");
        }
    }

    /// Something this device is saying, rather than repeating.
    ///
    /// Marked seen before it goes out, so a copy coming back off a plane, which happens whenever two
    /// devices are linked on both radios at once, is recognised as our own and not handed to the
    /// window a second time.
    pub fn publish(&self, body: Vec<u8>) {
        self.seen.lock().unwrap().first(mark_of(&body));
        let shared = Arc::new(body);
        for plane in self.snapshot() {
            plane.send(Arc::clone(&shared), DEFAULT_TTL);
        }
    }

    pub fn stop(&self) {
        let planes: Vec<Arc<dyn Plane>> = self.planes.lock().unwrap().drain(..).collect();
        for plane in planes {
            plane.stop();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gate_lets_a_message_through_once() {
        let mut seen = Seen::new();
        assert!(seen.first(7));
        assert!(!seen.first(7));
        assert!(seen.first(8));
    }

    #[test]
    fn the_gate_forgets_the_oldest_rather_than_growing_forever() {
        let mut seen = Seen::new();
        for mark in 0..(SEEN_LIMIT as u64 + 10) {
            assert!(seen.first(mark));
        }
        assert_eq!(seen.marks.len(), SEEN_LIMIT);
        // The earliest marks have aged out, so an echo that late reads as new. That is correct:
        // nothing is still in flight a thousand messages later.
        assert!(seen.first(0));
        assert!(!seen.first(SEEN_LIMIT as u64));
    }

    #[test]
    fn different_bytes_get_different_marks() {
        assert_ne!(mark_of(b"go on 12"), mark_of(b"go on 13"));
        assert_eq!(mark_of(b"standby"), mark_of(b"standby"));
    }
}
