//! The Bluetooth wire format, on the host side.
//!
//! A browser can only be a BLE central: the Web Bluetooth API exposes the GATT client role and
//! nothing else, so a page can neither advertise nor host a GATT server. Every device that relays
//! for the room is therefore native, and this is the half that runs there.
//!
//! It is deliberately a mirror of `src/lib/mesh.ts` rather than anything cleverer. The two ends have
//! to agree on every byte, and the way to keep them agreeing is for both to be short, both to be
//! tested, and both to check themselves against the same hand-written fixture -- see
//! `frame_layout_is_fixed` below and the matching test in `mesh.test.ts`. Neither is generated from
//! the other, so a change to one that the other does not know about fails here.
//!
//! No Bluetooth in this crate on purpose. Framing and hop counting are the parts worth testing and
//! they need no radio; the platform binding sits on top and stays thin enough to read.

/// ATT payload at the usual negotiated MTU of 247: three bytes of that are the ATT header.
pub const BLE_FRAME: usize = 244;

/// `magic | version | msg_id(2) | index(2) | total(2) | ttl`
pub const FRAME_HEADER: usize = 9;

/// How far a message travels before it is dropped: desk, wings, circle, back of house.
pub const DEFAULT_TTL: u8 = 4;

const MAGIC: u8 = 0xc0;
const VERSION: u8 = 1;

/// A frame as it came off the wire, with its header read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameHead<'a> {
    pub msg_id: u16,
    pub index: u16,
    pub total: u16,
    pub ttl: u8,
    pub body: &'a [u8],
}

/// A whole message, once every frame of it has arrived.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub msg_id: u16,
    /// The fewest hops any copy of this took, which is the honest figure.
    pub ttl: u8,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChunkError {
    /// A frame size with no room left for the header carries nothing.
    FrameTooSmall,
    /// More frames than a two-byte index can address.
    TooManyFrames,
}

/// One message, cut into frames small enough to write.
pub fn chunk(body: &[u8], msg_id: u16, ttl: u8, frame_size: usize) -> Result<Vec<Vec<u8>>, ChunkError> {
    let room = frame_size.checked_sub(FRAME_HEADER).filter(|r| *r > 0).ok_or(ChunkError::FrameTooSmall)?;
    let total = body.len().div_ceil(room).max(1);
    if total > u16::MAX as usize {
        return Err(ChunkError::TooManyFrames);
    }
    let mut frames = Vec::with_capacity(total);
    for index in 0..total {
        let slice = &body[(index * room).min(body.len())..((index + 1) * room).min(body.len())];
        let mut frame = Vec::with_capacity(FRAME_HEADER + slice.len());
        frame.push(MAGIC);
        frame.push(VERSION);
        frame.extend_from_slice(&msg_id.to_be_bytes());
        frame.extend_from_slice(&(index as u16).to_be_bytes());
        frame.extend_from_slice(&(total as u16).to_be_bytes());
        frame.push(ttl);
        frame.extend_from_slice(slice);
        frames.push(frame);
    }
    Ok(frames)
}

/// Reads a frame, or `None` when it is not one of ours -- another app on the same characteristic.
pub fn read_frame(frame: &[u8]) -> Option<FrameHead<'_>> {
    if frame.len() < FRAME_HEADER || frame[0] != MAGIC || frame[1] != VERSION {
        return None;
    }
    let msg_id = u16::from_be_bytes([frame[2], frame[3]]);
    let index = u16::from_be_bytes([frame[4], frame[5]]);
    let total = u16::from_be_bytes([frame[6], frame[7]]);
    if total == 0 || index >= total {
        return None;
    }
    Some(FrameHead { msg_id, index, total, ttl: frame[8], body: &frame[FRAME_HEADER..] })
}

/// What to put on the wire when passing a message on, or `None` to stop here.
///
/// Without this, two devices in range of each other pass one cue back and forth until the batteries
/// die.
pub fn relay_ttl(ttl: u8) -> Option<u8> {
    if ttl > 1 { Some(ttl - 1) } else { None }
}

struct Partial {
    frames: Vec<Option<Vec<u8>>>,
    have: usize,
    total: u16,
    ttl: u8,
    /// Monotonic tick supplied by the caller, so this crate needs no clock of its own.
    at: u64,
}

/// Puts frames back into messages.
///
/// Bounded in both directions. `limit` caps how many part-finished messages are held at once,
/// because a device that walks out of range mid-message would otherwise leave a fragment in memory
/// for the rest of the night; `expire_after` drops one whose remaining frames never arrived. Both
/// matter more here than on a reliable wire: BLE loses a device the moment somebody shuts a door.
pub struct Reassembler {
    pending: Vec<(u16, Partial)>,
    limit: usize,
    expire_after: u64,
}

impl Reassembler {
    pub fn new(limit: usize, expire_after: u64) -> Self {
        Self { pending: Vec::new(), limit, expire_after }
    }

    pub fn pending(&self) -> usize {
        self.pending.len()
    }

    pub fn forget(&mut self) {
        self.pending.clear();
    }

    fn expire(&mut self, now: u64) {
        let cutoff = now.saturating_sub(self.expire_after);
        self.pending.retain(|(_, held)| held.at >= cutoff);
    }

    /// Returns the whole message once its last frame lands, and `None` until then.
    pub fn accept(&mut self, frame: &[u8], now: u64) -> Option<Message> {
        let head = read_frame(frame)?;
        self.expire(now);

        if head.total == 1 {
            return Some(Message { msg_id: head.msg_id, ttl: head.ttl, body: head.body.to_vec() });
        }

        let at = self.pending.iter().position(|(id, _)| *id == head.msg_id);
        // Same id, different length: an id has wrapped onto a message still in flight. The older one
        // is the one to lose, since the newer frames are the ones still arriving.
        if let Some(at) = at {
            if self.pending[at].1.total != head.total {
                self.pending.remove(at);
            }
        }

        let at = match self.pending.iter().position(|(id, _)| *id == head.msg_id) {
            Some(at) => at,
            None => {
                self.pending.push((
                    head.msg_id,
                    Partial {
                        frames: vec![None; head.total as usize],
                        have: 0,
                        total: head.total,
                        ttl: head.ttl,
                        at: now,
                    },
                ));
                // Oldest out first, so a stream of half-heard messages cannot grow without limit.
                while self.pending.len() > self.limit {
                    self.pending.remove(0);
                }
                self.pending.len() - 1
            }
        };

        let held = &mut self.pending[at].1;
        if held.frames[head.index as usize].is_some() {
            return None; // heard this frame already, over another link
        }
        held.frames[head.index as usize] = Some(head.body.to_vec());
        held.have += 1;
        held.at = now;
        held.ttl = held.ttl.min(head.ttl);
        if held.have < held.total as usize {
            return None;
        }

        let (msg_id, done) = self.pending.remove(at);
        let mut body = Vec::new();
        for part in done.frames.into_iter().flatten() {
            body.extend_from_slice(&part);
        }
        Some(Message { msg_id, ttl: done.ttl, body })
    }
}

/// Message ids are two bytes and wrap. They only have to be unique among what is still in flight.
pub struct MessageIds(u16);

impl MessageIds {
    pub fn new(start: u16) -> Self {
        Self(start)
    }
    pub fn next(&mut self) -> u16 {
        self.0 = self.0.wrapping_add(1);
        self.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn body(n: usize) -> Vec<u8> {
        (0..n).map(|i| (i % 251) as u8).collect()
    }

    /// The one test that matters for interop.
    ///
    /// These bytes are written out by hand and asserted identically in `src/lib/mesh.test.ts`.
    /// Neither implementation is generated from the other, so a change to either that the other does
    /// not know about fails on one side or the other rather than in a venue.
    #[test]
    fn frame_layout_is_fixed() {
        let frames = chunk(&[1, 2, 3], 0x1234, 4, BLE_FRAME).unwrap();
        assert_eq!(frames.len(), 1);
        assert_eq!(
            frames[0],
            vec![0xc0, 0x01, 0x12, 0x34, 0x00, 0x00, 0x00, 0x01, 0x04, 1, 2, 3]
        );
    }

    #[test]
    fn a_short_message_is_one_frame() {
        assert_eq!(chunk(&body(10), 1, DEFAULT_TTL, BLE_FRAME).unwrap().len(), 1);
    }

    #[test]
    fn no_frame_is_larger_than_a_gatt_write() {
        for frame in chunk(&body(5_000), 1, DEFAULT_TTL, BLE_FRAME).unwrap() {
            assert!(frame.len() <= BLE_FRAME);
        }
    }

    #[test]
    fn an_empty_message_still_goes() {
        assert_eq!(chunk(&[], 1, DEFAULT_TTL, BLE_FRAME).unwrap().len(), 1);
    }

    #[test]
    fn a_frame_with_no_room_for_a_header_is_refused() {
        assert_eq!(chunk(&body(10), 1, DEFAULT_TTL, FRAME_HEADER), Err(ChunkError::FrameTooSmall));
    }

    #[test]
    fn traffic_that_is_not_ours_is_ignored() {
        // Another app writing to the same characteristic must not be parsed as a cue.
        assert!(read_frame(&[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).is_none());
        assert!(read_frame(&[0; 4]).is_none());
    }

    #[test]
    fn an_index_outside_its_own_total_is_ignored() {
        let mut frame = chunk(&body(10), 1, DEFAULT_TTL, BLE_FRAME).unwrap().remove(0);
        frame[4] = 0;
        frame[5] = 9; // index 9 of 1
        assert!(read_frame(&frame).is_none());
    }

    #[test]
    fn a_split_message_comes_back_whole() {
        let mut join = Reassembler::new(32, 20_000);
        let original = body(3_000);
        let frames = chunk(&original, 42, DEFAULT_TTL, BLE_FRAME).unwrap();
        assert!(frames.len() > 1);
        let last = frames.len() - 1;
        for frame in &frames[..last] {
            assert!(join.accept(frame, 0).is_none());
        }
        assert_eq!(join.accept(&frames[last], 0).unwrap().body, original);
    }

    #[test]
    fn frame_order_does_not_matter() {
        let mut join = Reassembler::new(32, 20_000);
        let original = body(2_000);
        let mut frames = chunk(&original, 9, DEFAULT_TTL, BLE_FRAME).unwrap();
        frames.reverse();
        let mut out = None;
        for frame in &frames {
            out = join.accept(frame, 0).or(out);
        }
        assert_eq!(out.unwrap().body, original);
    }

    #[test]
    fn the_same_frame_twice_is_survivable() {
        let mut join = Reassembler::new(32, 20_000);
        let original = body(400);
        let frames = chunk(&original, 5, DEFAULT_TTL, BLE_FRAME).unwrap();
        assert_eq!(frames.len(), 2);
        assert!(join.accept(&frames[0], 0).is_none());
        assert!(join.accept(&frames[0], 0).is_none()); // heard again, relayed
        assert_eq!(join.accept(&frames[1], 0).unwrap().body, original);
    }

    #[test]
    fn the_fewest_hops_wins() {
        let mut join = Reassembler::new(32, 20_000);
        let original = body(400);
        let direct = chunk(&original, 3, 4, BLE_FRAME).unwrap();
        let relayed = chunk(&original, 3, 2, BLE_FRAME).unwrap();
        join.accept(&relayed[0], 0);
        assert_eq!(join.accept(&direct[1], 0).unwrap().ttl, 2);
    }

    #[test]
    fn a_message_that_never_finishes_is_dropped() {
        let mut join = Reassembler::new(32, 1_000);
        let frames = chunk(&body(2_000), 11, DEFAULT_TTL, BLE_FRAME).unwrap();
        join.accept(&frames[0], 0);
        assert_eq!(join.pending(), 1);
        let other = chunk(&body(10), 12, DEFAULT_TTL, BLE_FRAME).unwrap();
        join.accept(&other[0], 5_000); // any traffic triggers the sweep
        assert_eq!(join.pending(), 0);
    }

    #[test]
    fn only_so_many_part_finished_messages_are_held() {
        let mut join = Reassembler::new(3, 20_000);
        for id in 0..10u16 {
            let frames = chunk(&body(2_000), id, DEFAULT_TTL, BLE_FRAME).unwrap();
            join.accept(&frames[0], 0);
        }
        assert!(join.pending() <= 3);
    }

    #[test]
    fn a_wrapped_id_does_not_stitch_two_messages_together() {
        let mut join = Reassembler::new(32, 20_000);
        let stale = chunk(&body(2_000), 77, DEFAULT_TTL, BLE_FRAME).unwrap();
        join.accept(&stale[0], 0);
        let fresh = chunk(&body(400), 77, DEFAULT_TTL, BLE_FRAME).unwrap();
        assert!(join.accept(&fresh[0], 0).is_none());
        assert_eq!(join.accept(&fresh[1], 0).unwrap().body, body(400));
    }

    #[test]
    fn hops_count_down_and_stop() {
        assert_eq!(relay_ttl(4), Some(3));
        assert_eq!(relay_ttl(2), Some(1));
        assert_eq!(relay_ttl(1), None);
        assert_eq!(relay_ttl(0), None);
    }

    #[test]
    fn ids_wrap_rather_than_overflow() {
        let mut ids = MessageIds::new(u16::MAX - 1);
        assert_eq!(ids.next(), u16::MAX);
        assert_eq!(ids.next(), 0);
    }
}
