# The feedback pass

Twenty-seven pieces of feedback, plus a request to make CueFlow run offline as a native app on
Android and Windows over a mesh of local devices. This is what each one turned out to be, what was
done about it, and what was not.

It is written down because most of these were not the bug they looked like. "Shows are not working"
was four separate defects in the show runtime; "the database is not syncing" was a merge function
that could only add rows. Anyone picking this up later needs the diagnosis, not just the diff.

---

## What was actually wrong

The twenty-seven items collapsed into six root causes. Fixing symptoms one at a time would have
produced twenty-seven patches and left all six in place.

| # | Root cause | Feedback it produced |
|---|---|---|
| R1 | The show is a broadcast with no durable state, and its handshake raced the socket | 1, 4, 18, 19 |
| R2 | Audio is one element, device-local, and the crew view had no engine at all | 8, 17, 23 |
| R3 | Sync is save-on-change plus hydrate-once, with an add-only merge | 7, 22 |
| R4 | There is no design system; hierarchy is ad-hoc Tailwind per call site | 6, 26, 27, 9, 10, 2 |
| R5 | Four onboarding mechanisms, and the tour auto-completed its own first two steps | 3 |
| R6 | Studio re-renders constantly and does expensive work on the hot path | 12, 16 |

---

## Item by item

**1. Shows are not working.** Four defects, all in `Show.tsx` and `Studio.tsx`.

The handshake raced the socket: `Show.tsx` sent its `here` -- the message that asks the host for the
deck -- the instant `showChannel()` returned, and `showChannel` called `.subscribe()` without waiting
for the join. The message went out before the channel existed and was dropped. No retry, no timeout,
so the crew device sat on "Waiting for the host to send the deck" for the rest of the night. Both
call sites now go through `useShowLink`, which queues anything sent before the link is up, re-sends
the greeting on every reconnect, and retries with backoff.

Perms were decorative. They decided which buttons a crew device drew; the host acted on any `fire`,
`relabel` or `flash` that arrived from anyone who knew the show id, and answered any `here` with the
whole script. Crew messages now carry the member id the server issued at the door, and the host
checks it against `show_state` before acting.

Cues could fire from the wrong sequence: `playCue` indexed whatever the operator had open, so
switching sequences turned a crew "Go" on cue 4 into whatever now sat at position 4. The deck
carries its sequence id and a `fire` carries it back.

The deck only resent on `[stage.n, liveShow.id]`, so renaming a cue, reordering the sequence or
loading a script left every crew device holding a stale list.

**2. Simpler UI, concept and text.** Partly. The features page said the same three things twice and
now does not; the closing call to action existed in three spellings across three pages and is now one
component; two slider primitives became one; a duplicate setting was removed. The typography sweep
below is the other half. This item is a direction rather than a defect, so it is not "done" so much
as moved.

**3. Fix tutorials.** The first two steps completed themselves in under a second. Step 1 tested
`endsWith("/studio") || endsWith("/workspace")` and its polling interval only runs when the path
already ends in one of those -- true on the first tick by construction. Step 2 tested
`session().selectedId`, and the Studio seeds a selection from the first track before it paints. A new
operator was dumped at step 3 with no idea what had happened.

Inside a project it was worse: the Studio scopes its storage keys by project id and the tutorial did
not, so four of nine steps could never complete and the demo library was written where nobody in a
project could see it.

The spotlight also gave up permanently -- after 2.5 seconds it disconnected its observer and the
effect only re-ran on `[selector, active]`, so a control from a lazily loaded chunk was never noticed
while the step's `done()` interval carried on polling invisibly.

**4. Make the shows proper.** See 1, plus the roster and waiting room in 19.

**5. Repetitive and confusing features.** The "Prepare / Rehearse / Operate" trio on the features page
restated three cards above it. Replaced with the eight things the page never mentioned at all:
projects and collaborators, the script reader's pre-alerts, the editors, linked cues, the audience
window, per-job permissions, the command palette and sync.

**6. Hierarchy through size, weight, colour, motion.** There were nineteen spellings of two small-caps
labels across forty call sites: seven letter spacings, four sizes, both weights. Not wrong
individually -- they simply never agreed, so nothing ranked against anything else. Two classes now,
`.eyebrow` and `.label-cap`, with colour still at the call site because that is the part that
genuinely differs.

**7, 22. Cross-device and cross-collaborator syncing.** `mergeInto` could only add. An existing track
hit `continue`, so a remote rename, URL or effect change was discarded; an existing sequence got the
union of its cues, so a reorder was lost and a deleted cue came back. Then the stale device saved its
own arrays over the top -- so device B did not merely fail to see device A's work, it destroyed it.

It is a three-way merge now, against a per-device record of what the cloud last held. That baseline is
what makes an edit, an absence and a deletion three different things instead of one ambiguous
difference. Neither common case needs a clock: if this device has not touched a row since the last
sync, the other copy is newer, and vice versa. Only a genuine both-sides edit falls back to
`updated_at`, and a tie keeps what is on screen.

Nothing was subscribed to table changes anywhere in the app -- the only `.channel(` call was the show
broadcast. `watchCloud` subscribes to `postgres_changes` and re-merges.

**8. No soundboard or way to edit audio.** The editors existed and were never mentioned on the
marketing pages (see 5). The soundboard did not: ten pads to a bank on the number keys while a deck
is armed, favourites first, press again to stop.

**9, 10. Ease of access, simplicity.** See 2, 6, 27.

**11. Vertical sliders.** `ui.tsx`'s Slider takes an `orientation`, and the four raw `metal-range`
inputs are gone, so there is one slider rather than two sets of focus styles and keyboard behaviours.

**12, 16. Lag and responsiveness.** `Studio.tsx` is 1,600 lines with no `useMemo`, `useCallback` or
`React.memo` anywhere. The two that mattered on a live show: dragging an effects slider rebuilt up to
eight `HTMLAudioElement`s per frame, each with a `load()`, and each frame also did a
`structuredClone` of every sequence plus a synchronous `localStorage` write. Also a keydown listener
re-attached every render, a whole-tree re-render at 4 Hz from `timeupdate` and 10 Hz from the cue
timer, a fresh `AudioContext` per decoded file against a browser cap of about six, and an unbounded
decode cache.

**13. Pause button and keybind.** An armed deck unmounts the Player, so the only pause was a keybind
-- and that keybind acted on the editor's element rather than on the sound the audience could hear.
Nothing on screen said pausing was possible. The armed bar now carries play/pause, stop-all, a scrub
and the elapsed time. Space also double-fired with a button focused; buttons are excluded from the
keydown path now.

**14. Split screen or popup control panel.** New `/control` route: the cue list in its own window for
the second screen. It holds no state -- everything came from the Studio over the same BroadcastChannel
the audience window uses, and every press goes back the same way.

**15. More diverse info.** See 5.

**17, 23. Sound not heard by the person controlling the show.** A crew screen mounted no audio at all.
The sound came out of whichever machine the file was stored on, so somebody calling cues from their
phone heard nothing and could not tell whether a cue had gone out. Withholding the URLs was
deliberate -- "a device that only reads cues has no business being able to download them" -- but a
device allowed to fire one has to be able to make the sound. URLs go to members the server says hold
`fire`, and nobody else.

**18. Update jobs as new members enter.** A job could always be rewritten, but the change only
reached a device that happened to reload, so a crew member could be holding powers the host had
already taken away. Changing a job now reaches the device immediately, and drops the host's cached
copy of that member's perms at the same moment.

**19. Waiting room.** Admission is a switch, off by default. Off, a key gets you in exactly as before.
On, arrivals wait and the host lets each through. The crew device gets a waiting screen that changes
on its own, and a refusal says so.

**20. Username propagation.** The name a show called you was whatever had been typed into the join box
on that browser, once. A signed-in account's own name wins now, and changing it re-announces to the
room. Project collaborator lists already resolved through `profiles` and needed no change.

**21. Friends list.** A list of usernames, so inviting someone is picking a name instead of spelling
it. Grants nothing on its own.

**24. More physical buttons on a PC.** The soundboard's number keys, plus `stopAll` on `.`.

**25. Blue rectangle in the audience window.** Root-caused. `location.pathname === "/audience"` fails
on `/audience/` and on a non-root `BASE_PATH`, so the cookie banner rendered as a narrow glass column
at the bottom left of the projected screen. Three other overlays had no route guard at all. Fixed
with one shared `useOnStage` check, plus a global `:focus-visible` ring so the browser's own
`#005FCC` outline stops appearing on a black stage.

**26. Organize layout better.** See 6, 2, 14.

**27. Accessibility.** Upload was mouse-only: both file pickers wrapped their input in `hidden`,
which is `display: none`, which takes the only focusable element out of the tab order -- so the
primary way of getting material into the app could not be reached from a keyboard. No skip link
existed on any page. Three text colours were below 4.5:1, and `border-default-200` is a HeroUI v2
token that does not exist in v3, so four dashed empty-state borders rendered with no colour at all.

---

## Offline, native, and the mesh

The second request was an Android and Windows app working offline over a Bluetooth-and-Wi-Fi mesh.

**What is done.** The show transport is pluggable: `Transport`, `Link`, `Envelope` and a router that
picks the best available wire, dedupes messages arriving over more than one of them, and re-probes
when one drops. Payload limits are on the interface because BLE and the cloud differ by orders of
magnitude, and an oversized send throws rather than vanishing. Supabase Realtime is the first
backend; a LAN backend and a BLE backend slot in beside it without the show layer knowing.

**What the research changed.** Android-to-Windows Wi-Fi Direct peer-to-peer is a dead end for a
third-party app. Microsoft's own sample has an unfixed reconnect bug against Android phones, the
Win32 path requires prior pairing through the Windows UI, and only one app may hold a Wi-Fi Direct
connection at a time. Wi-Fi Aware has no Windows API at all. The workable shape is: get every device
onto one L2 network -- a travel router, a Windows soft AP, or an Android local-only hotspot -- then
plain TCP with a custom UDP discovery. Flying Carpet, a Tauri v2 and Rust app, is the precedent.

Three things to design for rather than discover later: Android 17 (API 37) puts all local-network
traffic behind a new `ACCESS_LOCAL_NETWORK` permission; Android drops multicast without a JVM-side
`MulticastLock`, so discovery needs a unicast subnet-scan fallback; and a no-internet AP lands in
Windows Firewall's Public profile, so an elevated inbound rule is needed at install time.

**What is not done, and why.** The Bluetooth half of the research never completed -- the agent
running it hit an account session limit. Tauri v2's Android maturity, the BLE crate landscape and
real BLE throughput are all unverified, so the BLE transport has not been designed. Guessing at
version numbers and API surfaces to fill that gap would produce something that looks finished and
is not.

Also not done: the WebRTC fallback for cue audio. The only case that produces an unreachable file is
an upload that has not finished or has failed, and saying so is more honest than a half-built peer
relay.

---

## The database

`supabase/migrations/0001_cueflow.sql` is thirteen lines describing three tables. The app also uses
`shows`, `show_roles`, `show_members`, `projects`, `project_members`, `profiles` and
`editor_sessions`, and the RPCs `join_show`, `show_state`, `add_collaborator` and `touch_last_seen`.
None of those are in version control; they exist only in the live project. Run
`supabase db pull --schema public,storage` and commit the real baseline.

`0002_sync_and_shows.sql` sits on top of whatever that turns out to be. It is additive, guarded with
`if not exists`, and safe to run twice.

**It runs against a live database with real shows in it. Take a backup first, and read it before
applying it.** It adds `updated_at` with a trigger, `deleted_at` tombstones, `show_members.status`
and an owner-only `admit_member`, a friendships table, the realtime publication, and a storage policy
that matches where the client actually uploads -- the checked-in policy requires the first path
segment to equal the caller's uid, and the client has always written to `public/`, so the two have
never agreed.

The client works either side of it: it probes for `tracks.updated_at` once per session and falls back
to comparing row content when it is absent.
