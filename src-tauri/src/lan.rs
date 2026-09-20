//! The Wi-Fi/LAN plane of the show mesh.
//!
//! This plane carries show bytes between CueFlow devices that can see each other on the
//! same IP network: a venue Wi-Fi, a dedicated show router, or a phone hotspot. It finds
//! peers with a UDP beacon, then opens one long lived TCP connection per peer and keeps
//! it open for the run of the show.
//!
//! What this plane is NOT:
//! * It is not the mesh. It does not dedup, it does not decide what reaches the webview,
//!   and it does not re-flood within itself. `Hub` owns all of that. LAN is a full mesh
//!   (every device is connected to every other device), so anything received here has
//!   already reached every other LAN device directly; re-flooding would only double
//!   traffic and lean harder on the hub's dedup table.
//! * It is not a transport for the whole show file. `MAX_FRAME` is 1 MiB, which is a cue
//!   stack and a script page, not video.
//! * It is not reliable across a Wi-Fi drop. When the network dies, peers die with it and
//!   the BLE plane is what keeps the show running. That is the point of having two planes.
//! * It is not encrypted or authenticated. Anything that can reach the show network can
//!   speak to it. The show network is expected to be a closed rehearsal/venue network.
//!
//! Platform notes for whoever wires the Android side:
//! * Android will not deliver multicast datagrams to the app unless a `WifiManager
//!   .MulticastLock` is held. Rust cannot take that lock; it has to be acquired and
//!   released from Kotlin around the life of this plane. Because that is easy to forget
//!   and easy to lose on a device policy change, the beacon also goes out as a subnet
//!   broadcast on every interface, and discovery works on broadcast alone. Multicast is
//!   an improvement, never a requirement.
//! * Android 17 (API 37) puts local network access behind the `ACCESS_LOCAL_NETWORK`
//!   runtime permission. Without it, every send and connect here fails with a permission
//!   error and the device will simply never find a peer. Request it before calling
//!   `start`, and surface the denial in the UI; a stage manager needs to be told "this
//!   tablet is not allowed on the show network", not left staring at zero peers.
//! * `SO_REUSEPORT` does not exist on Windows, so it is compiled out there.

use std::collections::{HashMap, HashSet};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use socket2::{Domain, Protocol, SockAddr, Socket, Type};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::net::{TcpListener, TcpStream, UdpSocket};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use tracing::{debug, info, warn};

use crate::hub::{Hub, Plane};

/// The plane name the hub knows us by.
pub const PLANE_ID: &str = "lan";

/// Biggest body we will accept off the wire. A cue is a few hundred bytes; a full script
/// page with notes is a few kilobytes. A megabyte is already absurd, so anything larger is
/// either a bug or someone poking at the port.
pub const MAX_FRAME: usize = 1_048_576;

/// Discovery lives on one fixed UDP port so a single firewall rule covers it.
const DISCOVERY_PORT: u16 = 7377;

/// Preferred TCP port, same number, same reason.
const PREFERRED_TCP_PORT: u16 = 7377;

/// Administratively scoped multicast group, picked to spell the port.
const MULTICAST_GROUP: Ipv4Addr = Ipv4Addr::new(239, 255, 77, 7);

/// Two seconds is fast enough that a tablet waking from sleep rejoins before the next cue,
/// and slow enough that thirty devices do not flood the air.
const BEACON_PERIOD: Duration = Duration::from_secs(2);

/// Handshake line cap. Without it a stranger could open a socket and dribble bytes forever
/// while we buffered them, which is a free out-of-memory kill on a phone.
const MAX_HELLO_BYTES: usize = 1024;

/// A peer that cannot complete a TCP connect in this long is not on our network right now.
const DIAL_TIMEOUT: Duration = Duration::from_secs(4);

/// Outbound fan-out backlog. Deep enough to absorb a burst of cues while a slow tablet's
/// socket drains, shallow enough that a dead peer cannot pin megabytes of cues in memory.
const OUTBOUND_BACKLOG: usize = 256;

/// Beacons are small; this is generous for one datagram.
const UDP_READ_BUF: usize = 2048;

/// After an accept/recv error we pause before retrying, so a broken socket cannot spin the
/// CPU at full tilt and cook the battery mid show.
const ERROR_BACKOFF: Duration = Duration::from_millis(200);

// ---------------------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------------------

/// UDP discovery beacon. `cf` is a version marker so a future protocol change can be told
/// apart from noise on the port rather than parsed as garbage.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Beacon {
    cf: u8,
    show: String,
    device: String,
    port: u16,
}

/// First line on every TCP connection, in both directions.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Hello {
    cf: u8,
    show: String,
    device: String,
}

// ---------------------------------------------------------------------------------------
// Pure protocol helpers
//
// These are free functions on purpose: `Hub` is opaque from inside this module, so the unit
// tests below exercise the protocol here and the live wiring (a real Hub with two planes
// attached) is covered by the app level test instead.
// ---------------------------------------------------------------------------------------

/// 4 byte big endian length, body, then a single ttl byte.
fn encode_frame(body: &[u8], ttl: u8) -> Vec<u8> {
    let mut out = Vec::with_capacity(body.len() + 5);
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(body);
    out.push(ttl);
    out
}

/// Split out from frame reading so the size check cannot drift between the buffered path
/// and the streaming path; one limit, one place.
fn frame_len_from_header(header: [u8; 4]) -> Result<usize> {
    let len = u32::from_be_bytes(header) as usize;
    if len > MAX_FRAME {
        bail!(
            "A device on the show network announced a {len} byte cue, over CueFlow's {MAX_FRAME} byte limit. \
             That connection is being dropped. If it keeps happening, take that device off the show network and restart it."
        );
    }
    Ok(len)
}

/// The inverse of `encode_frame`, taken whole rather than streamed off a socket.
///
/// The wire never calls it: a connection reads the header and the body in two separate awaits, so
/// `read_frame` is the real path. This is the half the round trip test measures that path against,
/// and it is built only for tests rather than sitting unread in the shipped binary.
#[cfg(test)]
fn decode_frame(raw: &[u8]) -> Result<(Vec<u8>, u8)> {
    if raw.len() < 5 {
        bail!(
            "A cue arrived with only {} bytes, too short to be a CueFlow frame. Something other than CueFlow is talking on this connection.",
            raw.len()
        );
    }
    let mut header = [0u8; 4];
    header.copy_from_slice(&raw[..4]);
    let len = frame_len_from_header(header)?;
    if raw.len() != len + 5 {
        bail!(
            "A cue claimed {} bytes but carried {}. The connection is out of step and will be dropped.",
            len,
            raw.len().saturating_sub(5)
        );
    }
    Ok((raw[4..4 + len].to_vec(), raw[4 + len]))
}

/// Cancel unsafe by nature: a half read frame cannot be resumed. The only place we cancel
/// it is shutdown, where the peer is being torn down anyway.
async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<(Vec<u8>, u8)> {
    let mut header = [0u8; 4];
    r.read_exact(&mut header)
        .await
        .context("A device closed its connection before sending the next cue.")?;
    let len = frame_len_from_header(header)?;
    let mut body = vec![0u8; len];
    r.read_exact(&mut body)
        .await
        .context("A device dropped off the network partway through a cue.")?;
    let ttl = r
        .read_u8()
        .await
        .context("A device dropped off the network partway through a cue.")?;
    Ok((body, ttl))
}

async fn write_hello<W: AsyncWrite + Unpin>(w: &mut W, show: &str, device: &str) -> Result<()> {
    let hello = Hello {
        cf: 1,
        show: show.to_string(),
        device: device.to_string(),
    };
    let mut line = serde_json::to_vec(&hello)
        .context("CueFlow could not build its own handshake. This is a bug, please report it.")?;
    line.push(b'\n');
    w.write_all(&line)
        .await
        .context("CueFlow could not introduce itself to a device that just connected.")?;
    w.flush()
        .await
        .context("CueFlow could not introduce itself to a device that just connected.")?;
    Ok(())
}

/// Reads one newline terminated handshake, byte at a time, against `MAX_HELLO_BYTES`.
/// Pass a buffered reader: the per byte read is a buffer poke, not a syscall, and the same
/// reader must stay in use for frames afterwards or buffered frame bytes would be lost.
async fn read_hello<R: AsyncRead + Unpin>(r: &mut R) -> Result<Hello> {
    let mut line: Vec<u8> = Vec::with_capacity(128);
    loop {
        let b = r
            .read_u8()
            .await
            .context("A device disconnected before it finished introducing itself.")?;
        if b == b'\n' {
            break;
        }
        line.push(b);
        if line.len() > MAX_HELLO_BYTES {
            bail!(
                "A device sent more than {MAX_HELLO_BYTES} bytes of handshake without ending the line. \
                 Dropping it. Something other than CueFlow is connecting to port {PREFERRED_TCP_PORT}."
            );
        }
    }
    parse_hello(&line)
}

fn parse_hello(line: &[u8]) -> Result<Hello> {
    let hello: Hello = serde_json::from_slice(line)
        .context("A device sent a handshake CueFlow could not read. Check that both devices are running the same CueFlow version.")?;
    if hello.cf != 1 {
        bail!(
            "A device is speaking CueFlow protocol version {}, and this copy speaks version 1. Update both devices to the same version.",
            hello.cf
        );
    }
    if hello.device.trim().is_empty() {
        bail!("A device connected without a name. Give it a device name in Settings, then reconnect it.");
    }
    Ok(hello)
}

/// Returns the beacon only if it is worth acting on.
///
/// Rejects: malformed JSON, a protocol version we do not speak, a beacon for another show
/// (two productions sharing a venue Wi-Fi must not cross), a port of zero, and our own
/// beacon coming back to us off broadcast or multicast loopback.
fn parse_beacon(raw: &[u8], our_show: &str, our_device: &str) -> Option<Beacon> {
    let beacon: Beacon = serde_json::from_slice(raw).ok()?;
    if beacon.cf != 1 {
        return None;
    }
    if beacon.show != our_show {
        return None;
    }
    if beacon.device == our_device {
        return None;
    }
    if beacon.port == 0 || beacon.device.trim().is_empty() {
        return None;
    }
    Some(beacon)
}

/// Dial tie-break.
///
/// Both devices hear each other's beacon at roughly the same moment, so if both dialled we
/// would end up with two TCP sockets for one peer and every cue would arrive twice (the hub
/// would dedup it, but we would have burned double the bandwidth and confused the peer
/// count). The rule: the device whose name sorts lower dials, the higher one waits to be
/// dialled. It is arbitrary, it needs no negotiation, and both sides reach the same answer
/// from the beacon alone.
fn should_dial(our_device: &str, their_device: &str) -> bool {
    our_device < their_device
}

/// Some interfaces report no broadcast address, so derive it from address and mask.
fn derive_broadcast(ip: Ipv4Addr, netmask: Ipv4Addr) -> Ipv4Addr {
    Ipv4Addr::from(u32::from(ip) | !u32::from(netmask))
}

/// Where each beacon goes. Recomputed every tick on purpose: a stage tablet moves between
/// hotspot and house Wi-Fi mid rehearsal, and a target list cached at startup would point
/// at a subnet that no longer exists.
fn beacon_targets() -> Vec<SocketAddrV4> {
    let mut targets: Vec<SocketAddrV4> = Vec::new();
    let mut push = |ip: Ipv4Addr| {
        let addr = SocketAddrV4::new(ip, DISCOVERY_PORT);
        if !targets.contains(&addr) {
            targets.push(addr);
        }
    };

    // The multicast group first: it is the only path that crosses some managed APs which
    // filter directed broadcast.
    push(MULTICAST_GROUP);

    // Limited broadcast, which goes out the default route. On Android this is often the
    // only broadcast that is actually delivered.
    push(Ipv4Addr::BROADCAST);

    match if_addrs::get_if_addrs() {
        Ok(ifaces) => {
            for iface in ifaces {
                if iface.is_loopback() {
                    continue;
                }
                if let if_addrs::IfAddr::V4(v4) = iface.addr {
                    let bcast = v4.broadcast.unwrap_or_else(|| derive_broadcast(v4.ip, v4.netmask));
                    if !bcast.is_unspecified() {
                        push(bcast);
                    }
                }
            }
        }
        Err(e) => {
            // Not fatal: the limited broadcast and the multicast group are still in the list.
            warn!("CueFlow could not list this machine's network interfaces ({e}). Discovery will be limited to the default network.");
        }
    }
    targets
}

/// Beacons are jittered so devices powered on from the same power strip do not lock step
/// and collide on the air every two seconds.
fn beacon_jitter_ms() -> u64 {
    use rand::Rng;
    rand::rng().random_range(0..400)
}

// ---------------------------------------------------------------------------------------
// Socket setup
// ---------------------------------------------------------------------------------------

/// Prefers the fixed port so a firewall rule is possible, falls back to an ephemeral one so
/// a second CueFlow on the same laptop (normal in rehearsal: operator and a test client)
/// still starts instead of refusing to run.
///
/// Deliberately no `SO_REUSEADDR` here: we want the second bind to fail so we can detect the
/// shared machine case, and on Windows `SO_REUSEADDR` on a listener lets another process
/// steal the port outright.
fn bind_show_listener() -> Result<std::net::TcpListener> {
    let listener = match std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, PREFERRED_TCP_PORT)) {
        Ok(l) => l,
        Err(e) => {
            info!("Port {PREFERRED_TCP_PORT} is already in use ({e}), so this copy of CueFlow will use a spare port. Other devices will still find it.");
            std::net::TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).context(
                "CueFlow could not open any network port for the show. Check that the firewall is not blocking CueFlow, then restart the app.",
            )?
        }
    };
    listener
        .set_nonblocking(true)
        .context("CueFlow could not prepare its network port. Restart the app.")?;
    Ok(listener)
}

/// Receive socket for discovery, bound to the fixed port.
///
/// `SO_REUSEADDR` (plus `SO_REUSEPORT` where it exists) is what lets two CueFlow instances
/// on one laptop both listen on 7377. Without it the second one fails to start, which is a
/// rehearsal setup people actually use.
fn bind_discovery_socket() -> Result<std::net::UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .context("CueFlow could not create a network socket. Check that this device has Wi-Fi turned on.")?;
    sock.set_reuse_address(true)
        .context("CueFlow could not share the discovery port with another copy of itself.")?;
    // Windows has no SO_REUSEPORT; SO_REUSEADDR alone already gives the sharing we need there.
    #[cfg(all(unix, not(any(target_os = "solaris", target_os = "illumos"))))]
    sock.set_reuse_port(true)
        .context("CueFlow could not share the discovery port with another copy of itself.")?;
    sock.set_broadcast(true)
        .context("CueFlow could not enable network broadcast. On Android, check that local network access is allowed for CueFlow.")?;
    sock.bind(&SockAddr::from(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, DISCOVERY_PORT)))
        .with_context(|| format!(
            "CueFlow could not listen for other devices on UDP port {DISCOVERY_PORT}. Another program may be holding it; close it and start CueFlow again."
        ))?;
    sock.set_nonblocking(true)
        .context("CueFlow could not prepare the discovery socket. Restart the app.")?;
    Ok(sock.into())
}

/// Separate send socket on an ephemeral port, so beacon sending never contends with the
/// receive socket and a send error cannot take discovery down with it.
fn bind_beacon_socket() -> Result<std::net::UdpSocket> {
    let sock = Socket::new(Domain::IPV4, Type::DGRAM, Some(Protocol::UDP))
        .context("CueFlow could not create a network socket. Check that this device has Wi-Fi turned on.")?;
    sock.set_reuse_address(true)
        .context("CueFlow could not prepare the beacon socket.")?;
    sock.set_broadcast(true)
        .context("CueFlow could not enable network broadcast. On Android, check that local network access is allowed for CueFlow.")?;
    // TTL 1 keeps beacons on the local segment; a show network is one segment and we do not
    // want CueFlow beacons leaking into a building's wider network.
    let _ = sock.set_multicast_ttl_v4(1);
    // Loopback on, so two instances on one laptop see each other over multicast too.
    let _ = sock.set_multicast_loop_v4(true);
    sock.bind(&SockAddr::from(SocketAddrV4::new(Ipv4Addr::UNSPECIFIED, 0)))
        .context("CueFlow could not open a socket to announce itself. Check the firewall settings for CueFlow.")?;
    sock.set_nonblocking(true)
        .context("CueFlow could not prepare the beacon socket. Restart the app.")?;
    Ok(sock.into())
}

/// Joins the group on every interface we can. Returns how many joins succeeded; zero is not
/// an error, it just means this device is broadcast only (the usual case on Android without
/// a MulticastLock).
fn join_multicast(sock: &UdpSocket) -> usize {
    let mut joined = 0usize;
    // INADDR_ANY first: on some Android builds it is the only join that is permitted.
    if sock.join_multicast_v4(MULTICAST_GROUP, Ipv4Addr::UNSPECIFIED).is_ok() {
        joined += 1;
    }
    match if_addrs::get_if_addrs() {
        Ok(ifaces) => {
            for iface in ifaces {
                if iface.is_loopback() {
                    continue;
                }
                if let if_addrs::IfAddr::V4(v4) = iface.addr {
                    match sock.join_multicast_v4(MULTICAST_GROUP, v4.ip) {
                        Ok(()) => joined += 1,
                        Err(e) => debug!("Multicast join failed on {} ({e}); broadcast still covers this interface.", v4.ip),
                    }
                }
            }
        }
        Err(e) => debug!("Could not list interfaces for multicast join ({e}); broadcast still covers discovery."),
    }
    joined
}

// ---------------------------------------------------------------------------------------
// Plane state
// ---------------------------------------------------------------------------------------

struct PeerHandle {
    /// Connection generation, so a reader that dies after its socket was already replaced
    /// cannot evict the replacement.
    conn: u64,
    reader: JoinHandle<()>,
    writer: JoinHandle<()>,
}

/// Everything the background tasks need. Held behind an `Arc` separate from `LanPlane` so
/// tasks do not keep the public handle alive and there is no reference cycle.
struct Shared {
    show: String,
    device: String,
    tcp_port: u16,
    hub: Arc<Hub>,
    peers: Mutex<HashMap<String, PeerHandle>>,
    /// Devices with a dial in flight, so a beacon every two seconds does not stack up a
    /// dozen simultaneous connects to one slow tablet.
    dialing: Mutex<HashSet<String>>,
    outbound: broadcast::Sender<(Arc<Vec<u8>>, u8)>,
    shutdown: watch::Sender<bool>,
    next_conn: AtomicU64,
}

impl Shared {
    fn is_stopped(&self) -> bool {
        *self.shutdown.borrow()
    }
}

/// Resolves as soon as `stop()` has been called, and stays resolved afterwards.
async fn wait_for_shutdown(rx: &mut watch::Receiver<bool>) {
    loop {
        if *rx.borrow_and_update() {
            return;
        }
        if rx.changed().await.is_err() {
            // Sender gone means the plane is gone; treat it as shutdown.
            return;
        }
    }
}

/// The LAN carrier. Create it with [`start`], drop it or call [`Plane::stop`] to shut it down.
pub struct LanPlane {
    shared: Arc<Shared>,
    tasks: Mutex<Vec<JoinHandle<()>>>,
}

/// Brings the LAN plane up: TCP listener, UDP beacon, UDP discovery.
///
/// Must be called from inside a Tokio runtime (the sockets register with the reactor as they
/// are created). Returns as soon as the sockets are bound; peers appear asynchronously, so a
/// zero peer count right after this call is normal, not a failure.
pub fn start(show: &str, device: &str, hub: Arc<Hub>) -> Result<Arc<LanPlane>> {
    if device.trim().is_empty() {
        bail!("This device has no name yet. Set a device name in Settings before joining the show network.");
    }

    let std_listener = bind_show_listener()?;
    let tcp_port = std_listener
        .local_addr()
        .context("CueFlow could not read back the network port it just opened. Restart the app.")?
        .port();
    let listener = TcpListener::from_std(std_listener)
        .context("CueFlow could not start listening for other devices. Restart the app.")?;

    let discovery = UdpSocket::from_std(bind_discovery_socket()?)
        .context("CueFlow could not start listening for other devices. Restart the app.")?;
    let joined = join_multicast(&discovery);
    if joined == 0 {
        info!(
            "Multicast is unavailable on this device, so CueFlow is using network broadcast only. \
             On Android this usually means no MulticastLock is held. Discovery still works."
        );
    }
    let beacon = UdpSocket::from_std(bind_beacon_socket()?)
        .context("CueFlow could not start announcing itself to other devices. Restart the app.")?;

    let (outbound, _) = broadcast::channel(OUTBOUND_BACKLOG);
    let (shutdown, _) = watch::channel(false);

    let shared = Arc::new(Shared {
        show: show.to_string(),
        device: device.to_string(),
        tcp_port,
        hub,
        peers: Mutex::new(HashMap::new()),
        dialing: Mutex::new(HashSet::new()),
        outbound,
        shutdown,
        next_conn: AtomicU64::new(1),
    });

    let tasks = vec![
        tokio::spawn(accept_loop(shared.clone(), listener)),
        tokio::spawn(beacon_loop(shared.clone(), beacon)),
        tokio::spawn(discovery_loop(shared.clone(), discovery)),
    ];

    info!("LAN plane up for show \"{show}\" as \"{device}\" on port {tcp_port}.");
    Ok(Arc::new(LanPlane {
        shared,
        tasks: Mutex::new(tasks),
    }))
}

// ---------------------------------------------------------------------------------------
// Background tasks
// ---------------------------------------------------------------------------------------

async fn accept_loop(shared: Arc<Shared>, listener: TcpListener) {
    let mut stop = shared.shutdown.subscribe();
    loop {
        tokio::select! {
            _ = wait_for_shutdown(&mut stop) => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, addr)) => {
                    let shared = shared.clone();
                    // Handshakes are short lived and self cancelling: they check the
                    // shutdown flag before registering, so they are not tracked as tasks.
                    tokio::spawn(async move {
                        if let Err(e) = greet(shared, stream, addr).await {
                            debug!("Dropped an incoming connection from {addr}: {e:#}");
                        }
                    });
                }
                Err(e) => {
                    warn!("CueFlow could not accept a connection from another device ({e}). Still listening.");
                    tokio::time::sleep(ERROR_BACKOFF).await;
                }
            },
        }
    }
}

async fn beacon_loop(shared: Arc<Shared>, sock: UdpSocket) {
    let mut stop = shared.shutdown.subscribe();
    loop {
        let payload = match serde_json::to_vec(&Beacon {
            cf: 1,
            show: shared.show.clone(),
            device: shared.device.clone(),
            port: shared.tcp_port,
        }) {
            Ok(p) => p,
            Err(e) => {
                warn!("CueFlow could not build its discovery beacon ({e}). Other devices will not find this one; please report this.");
                return;
            }
        };

        for target in beacon_targets() {
            // One unusable interface (a disconnected Ethernet port, a VPN adapter) must not
            // stop the beacon going out on the interface that matters.
            if let Err(e) = sock.send_to(&payload, SocketAddr::V4(target)).await {
                debug!("Beacon to {target} failed: {e}");
            }
        }

        let wait = BEACON_PERIOD + Duration::from_millis(beacon_jitter_ms());
        tokio::select! {
            _ = wait_for_shutdown(&mut stop) => return,
            _ = tokio::time::sleep(wait) => {}
        }
    }
}

async fn discovery_loop(shared: Arc<Shared>, sock: UdpSocket) {
    let mut stop = shared.shutdown.subscribe();
    let mut buf = vec![0u8; UDP_READ_BUF];
    loop {
        let (n, from) = tokio::select! {
            _ = wait_for_shutdown(&mut stop) => return,
            received = sock.recv_from(&mut buf) => match received {
                Ok(v) => v,
                Err(e) => {
                    warn!("CueFlow could not read from the show network ({e}). Still listening.");
                    tokio::time::sleep(ERROR_BACKOFF).await;
                    continue;
                }
            },
        };

        let beacon = match parse_beacon(&buf[..n], &shared.show, &shared.device) {
            Some(b) => b,
            None => continue,
        };
        // Discovery is IPv4 only; the socket is bound IPv4 so anything else is impossible,
        // but matching keeps that assumption explicit instead of unwrapping.
        let ip = match from {
            SocketAddr::V4(v4) => *v4.ip(),
            SocketAddr::V6(_) => continue,
        };
        maybe_dial(&shared, ip, beacon);
    }
}

fn maybe_dial(shared: &Arc<Shared>, ip: Ipv4Addr, beacon: Beacon) {
    if shared.is_stopped() {
        return;
    }
    // See `should_dial`: only the lower sorting name dials, so we never end up with two
    // sockets for one peer.
    if !should_dial(&shared.device, &beacon.device) {
        return;
    }
    {
        let peers = shared.peers.lock().unwrap();
        if peers.contains_key(&beacon.device) {
            return;
        }
    }
    {
        let mut dialing = shared.dialing.lock().unwrap();
        if !dialing.insert(beacon.device.clone()) {
            return;
        }
    }

    let shared = shared.clone();
    tokio::spawn(async move {
        let addr = SocketAddrV4::new(ip, beacon.port);
        match tokio::time::timeout(DIAL_TIMEOUT, TcpStream::connect(addr)).await {
            Ok(Ok(stream)) => {
                if let Err(e) = greet(shared.clone(), stream, SocketAddr::V4(addr)).await {
                    debug!("Handshake with {} at {addr} failed: {e:#}", beacon.device);
                }
            }
            Ok(Err(e)) => {
                debug!("Could not connect to {} at {addr}: {e}", beacon.device);
            }
            Err(_) => {
                debug!("{} at {addr} did not answer within {DIAL_TIMEOUT:?}.", beacon.device);
            }
        }
        shared.dialing.lock().unwrap().remove(&beacon.device);
    });
}

/// Handshake, then hand the socket to the peer tasks. Used for both accepted and dialled
/// sockets: both sides write their own hello first and only then read the other's, so
/// neither can sit waiting on a peer that is waiting on it.
async fn greet(shared: Arc<Shared>, stream: TcpStream, addr: SocketAddr) -> Result<()> {
    // A cue is tiny and latency is the entire product, so Nagle must be off; a 40 ms delay
    // on a GO is the difference between a light hitting the line and missing it.
    stream
        .set_nodelay(true)
        .context("CueFlow could not set up a low latency connection to another device.")?;

    let (read_half, mut write_half) = stream.into_split();
    write_hello(&mut write_half, &shared.show, &shared.device).await?;

    let mut reader = BufReader::new(read_half);
    let theirs = read_hello(&mut reader).await?;

    if theirs.show != shared.show {
        bail!(
            "A device at {addr} is running the show \"{}\" and this device is running \"{}\". \
             Open the same show on both devices, then reconnect.",
            theirs.show,
            shared.show
        );
    }
    if theirs.device == shared.device {
        bail!(
            "A device at {addr} is using the same device name as this one (\"{}\"). \
             Give one of them a different name in Settings, otherwise they cannot tell each other apart.",
            shared.device
        );
    }

    register_peer(shared, theirs.device, addr, reader, write_half);
    Ok(())
}

fn register_peer(
    shared: Arc<Shared>,
    device: String,
    addr: SocketAddr,
    reader: BufReader<OwnedReadHalf>,
    writer: OwnedWriteHalf,
) {
    if shared.is_stopped() {
        return;
    }
    let conn = shared.next_conn.fetch_add(1, Ordering::Relaxed);
    // Subscribe before the peer is visible, so no cue sent between now and insertion is
    // missed by this writer.
    let rx = shared.outbound.subscribe();
    let writer_task = tokio::spawn(writer_loop(shared.clone(), device.clone(), conn, writer, rx));
    let reader_task = tokio::spawn(reader_loop(shared.clone(), device.clone(), conn, reader));

    let previous = {
        let mut peers = shared.peers.lock().unwrap();
        peers.insert(
            device.clone(),
            PeerHandle {
                conn,
                reader: reader_task,
                writer: writer_task,
            },
        )
    };

    if let Some(old) = previous {
        // A device that slept, lost Wi-Fi and came back dials again before its old socket
        // has finished dying. The newest socket is the live one; the stale one goes.
        old.reader.abort();
        old.writer.abort();
        info!("{device} reconnected from {addr}; replaced its previous connection.");
    } else {
        info!("{device} joined the show over Wi-Fi from {addr}.");
    }
    shared.hub.peers_changed();
}

async fn reader_loop(
    shared: Arc<Shared>,
    device: String,
    conn: u64,
    mut reader: BufReader<OwnedReadHalf>,
) {
    let mut stop = shared.shutdown.subscribe();
    loop {
        let frame = tokio::select! {
            _ = wait_for_shutdown(&mut stop) => break,
            frame = read_frame(&mut reader) => frame,
        };
        match frame {
            Ok((body, ttl)) => {
                // Straight to the hub, with no re-flood on this plane: every LAN device is
                // already directly connected to every other, so the peers have their copy.
                shared.hub.inbound(PLANE_ID, body, ttl);
            }
            Err(e) => {
                debug!("Connection to {device} ended: {e:#}");
                break;
            }
        }
    }
    remove_peer(&shared, &device, conn);
}

async fn writer_loop(
    shared: Arc<Shared>,
    device: String,
    conn: u64,
    mut writer: OwnedWriteHalf,
    mut rx: broadcast::Receiver<(Arc<Vec<u8>>, u8)>,
) {
    let mut stop = shared.shutdown.subscribe();
    loop {
        let (body, ttl) = {
            let received = tokio::select! {
                _ = wait_for_shutdown(&mut stop) => break,
                received = rx.recv() => received,
            };
            match received {
                Ok(msg) => msg,
                Err(broadcast::error::RecvError::Lagged(missed)) => {
                    // A slow or wedged device must not be cut off mid show: it is more
                    // useful attached and behind than detached. The hub resends state, and
                    // the operator sees it in the status panel.
                    warn!("{device} fell behind and missed {missed} messages over Wi-Fi. Keeping the connection.");
                    continue;
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        };

        let frame = encode_frame(&body, ttl);
        if let Err(e) = writer.write_all(&frame).await {
            debug!("Could not send to {device}: {e}");
            break;
        }
        if let Err(e) = writer.flush().await {
            debug!("Could not send to {device}: {e}");
            break;
        }
    }
    remove_peer(&shared, &device, conn);
}

fn remove_peer(shared: &Arc<Shared>, device: &str, conn: u64) {
    let removed = {
        let mut peers = shared.peers.lock().unwrap();
        match peers.get(device) {
            // Only evict our own generation: if this peer already reconnected, the entry
            // belongs to the newer socket and must be left alone.
            Some(handle) if handle.conn == conn => peers.remove(device),
            _ => None,
        }
    };
    if let Some(handle) = removed {
        handle.reader.abort();
        handle.writer.abort();
        info!("{device} left the show network.");
        shared.hub.peers_changed();
    }
}

// ---------------------------------------------------------------------------------------
// Plane implementation
// ---------------------------------------------------------------------------------------

impl Plane for LanPlane {
    fn id(&self) -> &'static str {
        PLANE_ID
    }

    fn send(&self, body: Arc<Vec<u8>>, ttl: u8) {
        if self.shared.is_stopped() {
            return;
        }
        if body.len() > MAX_FRAME {
            warn!(
                "A {} byte message is too large to send over Wi-Fi (the limit is {MAX_FRAME} bytes) and was not sent. \
                 Split the show file or send it another way.",
                body.len()
            );
            return;
        }
        // The ttl is passed through untouched: this plane is one hop wide, and the hub owns
        // the hop arithmetic when a message crosses to another plane.
        //
        // An error here just means no peers are attached, which is the normal state before
        // anyone else has booted.
        let _ = self.shared.outbound.send((body, ttl));
    }

    fn peers(&self) -> usize {
        self.shared.peers.lock().unwrap().len()
    }

    fn detail(&self) -> String {
        format!("port {}", self.shared.tcp_port)
    }

    fn stop(&self) {
        // send_replace never fails even with no receivers left, and tells us whether this is
        // the first stop, which keeps the call idempotent and quiet on the second go.
        let was_stopped = self.shared.shutdown.send_replace(true);

        let tasks: Vec<JoinHandle<()>> = self.tasks.lock().unwrap().drain(..).collect();
        for task in tasks {
            task.abort();
        }

        let peers: Vec<PeerHandle> = self
            .shared
            .peers
            .lock()
            .unwrap()
            .drain()
            .map(|(_, handle)| handle)
            .collect();
        let had_peers = !peers.is_empty();
        for peer in peers {
            peer.reader.abort();
            peer.writer.abort();
        }

        if had_peers {
            self.shared.hub.peers_changed();
        }
        if !was_stopped {
            info!("LAN plane stopped.");
        }
    }
}

impl Drop for LanPlane {
    fn drop(&mut self) {
        // Without this, dropping the plane would leave the accept and beacon tasks running
        // on the runtime with nothing owning them.
        Plane::stop(self);
    }
}

// ---------------------------------------------------------------------------------------
// Tests
//
// `Hub` is opaque from here, so these cover the protocol surface only: framing, the
// handshake, beacon filtering and the dial tie-break, plus one real localhost socket pair
// speaking the full wire protocol end to end. Two live `LanPlane`s attached to a real hub
// are covered by the app level test, which is the layer that can build a Hub.
// ---------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn beacon_json(show: &str, device: &str, port: u16) -> Vec<u8> {
        format!(r#"{{"cf":1,"show":"{show}","device":"{device}","port":{port}}}"#).into_bytes()
    }

    #[tokio::test]
    async fn frame_round_trip_keeps_body_and_ttl() -> Result<()> {
        let body = b"{\"cue\":\"LX 12\",\"go\":true}".to_vec();
        let raw = encode_frame(&body, 3);
        assert_eq!(raw.len(), body.len() + 5);
        let (decoded, ttl) = decode_frame(&raw)?;
        assert_eq!(decoded, body);
        assert_eq!(ttl, 3);

        // An empty body is legal and must survive too: it is how a bare keepalive looks.
        let (empty, ttl) = decode_frame(&encode_frame(b"", 1))?;
        assert!(empty.is_empty());
        assert_eq!(ttl, 1);
        Ok(())
    }

    #[tokio::test]
    async fn frame_reader_refuses_an_oversize_length() {
        let mut raw = Vec::new();
        raw.extend_from_slice(&u32::MAX.to_be_bytes());
        raw.extend_from_slice(b"not a megabyte of anything");

        assert!(decode_frame(&raw).is_err(), "decode must refuse a bogus length");

        let mut stream: &[u8] = &raw;
        let err = read_frame(&mut stream)
            .await
            .expect_err("the reader must refuse a bogus length instead of allocating 4 GiB");
        assert!(
            err.to_string().contains("limit"),
            "the technician facing message should mention the limit, got: {err}"
        );

        // Exactly at the limit is still allowed; only over it is refused.
        assert!(frame_len_from_header((MAX_FRAME as u32).to_be_bytes()).is_ok());
        assert!(frame_len_from_header(((MAX_FRAME + 1) as u32).to_be_bytes()).is_err());
    }

    #[tokio::test]
    async fn beacon_from_the_same_show_is_accepted() -> Result<()> {
        let beacon = parse_beacon(&beacon_json("Macbeth", "booth-mac", 7377), "Macbeth", "deck-tablet")
            .context("a well formed beacon for our show must be accepted")?;
        assert_eq!(beacon.device, "booth-mac");
        assert_eq!(beacon.port, 7377);

        // Junk on a shared port must be ignored, not crash discovery.
        assert!(parse_beacon(b"not json at all", "Macbeth", "deck-tablet").is_none());
        // A port of zero cannot be dialled.
        assert!(parse_beacon(&beacon_json("Macbeth", "booth-mac", 0), "Macbeth", "deck-tablet").is_none());
        Ok(())
    }

    #[tokio::test]
    async fn beacon_from_another_show_is_ignored() {
        // Two productions on one venue Wi-Fi must never cross cues.
        assert!(parse_beacon(&beacon_json("Hamlet", "booth-mac", 7377), "Macbeth", "deck-tablet").is_none());
    }

    #[tokio::test]
    async fn our_own_beacon_coming_back_is_ignored() {
        // Broadcast and multicast loopback both hand us our own beacon; dialling ourselves
        // would create a phantom peer in the status panel.
        assert!(parse_beacon(&beacon_json("Macbeth", "booth-mac", 7377), "Macbeth", "booth-mac").is_none());
    }

    #[tokio::test]
    async fn dial_tiebreak_is_one_sided() {
        // Exactly one of the pair dials, in either direction of discovery.
        assert!(should_dial("booth-mac", "deck-tablet"));
        assert!(!should_dial("deck-tablet", "booth-mac"));
        // Same name is a misconfiguration; neither side dials, and `greet` rejects it too.
        assert!(!should_dial("booth-mac", "booth-mac"));
    }

    #[tokio::test]
    async fn handshake_line_is_capped() {
        let flood = vec![b'x'; MAX_HELLO_BYTES * 2];
        let mut stream: &[u8] = &flood;
        assert!(
            read_hello(&mut stream).await.is_err(),
            "a peer that never sends a newline must be dropped, not buffered forever"
        );

        let mut good: &[u8] = b"{\"cf\":1,\"show\":\"Macbeth\",\"device\":\"booth-mac\"}\n";
        let hello = read_hello(&mut good).await.expect("a valid handshake must parse");
        assert_eq!(hello.device, "booth-mac");

        // A future protocol version is refused rather than misread.
        let mut future: &[u8] = b"{\"cf\":9,\"show\":\"Macbeth\",\"device\":\"booth-mac\"}\n";
        assert!(read_hello(&mut future).await.is_err());
    }

    #[tokio::test]
    async fn two_sockets_exchange_a_cue_on_localhost() -> Result<()> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let addr = listener.local_addr()?;

        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await?;
            stream.set_nodelay(true)?;
            let (read_half, mut write_half) = stream.into_split();
            write_hello(&mut write_half, "Macbeth", "booth-mac").await?;
            let mut reader = BufReader::new(read_half);
            let theirs = read_hello(&mut reader).await?;
            let (body, ttl) = read_frame(&mut reader).await?;
            anyhow::Ok((theirs.device, body, ttl))
        });

        let stream = TcpStream::connect(addr).await?;
        stream.set_nodelay(true)?;
        let (read_half, mut write_half) = stream.into_split();
        write_hello(&mut write_half, "Macbeth", "deck-tablet").await?;
        let mut reader = BufReader::new(read_half);
        let theirs = read_hello(&mut reader).await?;
        assert_eq!(theirs.device, "booth-mac");

        write_half.write_all(&encode_frame(b"GO LX 12", 2)).await?;
        write_half.flush().await?;

        let (device, body, ttl) = server.await??;
        assert_eq!(device, "deck-tablet");
        assert_eq!(body, b"GO LX 12");
        assert_eq!(ttl, 2);
        Ok(())
    }

    #[tokio::test]
    async fn broadcast_address_is_derived_when_the_interface_does_not_report_one() {
        assert_eq!(
            derive_broadcast(Ipv4Addr::new(192, 168, 1, 40), Ipv4Addr::new(255, 255, 255, 0)),
            Ipv4Addr::new(192, 168, 1, 255)
        );
        // Hotspots hand out /24s, house networks sometimes a /16; both must work.
        assert_eq!(
            derive_broadcast(Ipv4Addr::new(10, 0, 3, 7), Ipv4Addr::new(255, 255, 0, 0)),
            Ipv4Addr::new(10, 0, 255, 255)
        );
    }

    #[tokio::test]
    async fn beacon_targets_always_include_multicast_and_broadcast() {
        let targets = beacon_targets();
        assert!(targets.iter().any(|t| *t.ip() == MULTICAST_GROUP));
        assert!(targets.iter().any(|t| *t.ip() == Ipv4Addr::BROADCAST));
        assert!(targets.iter().all(|t| t.port() == DISCOVERY_PORT));
        // Duplicates would mean sending the same beacon twice on one interface.
        let mut seen = HashSet::new();
        assert!(targets.iter().all(|t| seen.insert(*t)));
    }
}
