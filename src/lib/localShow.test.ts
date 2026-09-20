import { beforeEach, describe, expect, it } from "vitest";
import { PERMS, ROLE_PRESETS, type Perm } from "./shows";
import {
  addLocalRole, deleteLocalRole, deleteLocalShow, isLocalKey, isLocalShowId, joinLocalShow, listLocalShows,
  localPerms, localRoles, localRoster, localTicket, newLocalShow, rememberDoor, updateLocalRole, updateLocalShow,
} from "./localShow";

/**
 * The door, with the database taken away.
 *
 * Every one of these is a thing that has to work in a venue with no internet, which is the one
 * place this code path runs and the one place nobody can open a console and look.
 */
beforeEach(() => localStorage.clear());

const AMBIGUOUS = /[O0I1L]/;

describe("minting a show", () => {
  it("makes the id the code that gets read out", () => {
    const show = newLocalShow("Macbeth", null);
    expect(show.id).toMatch(/^CF-[A-Z0-9]{6}$/);
    expect(isLocalShowId(show.id)).toBe(true);
    // Read aloud across a dark theatre, so the letters that get heard as each other are not in it.
    expect(show.id.slice(3)).not.toMatch(AMBIGUOUS);
    // One string, not two. A host who reads out the id has read out something that works.
    expect(show.password).toBe(show.id);
  });

  it("arrives with the three standard jobs, each with its own key", () => {
    const show = newLocalShow("Macbeth", null);
    const roles = localRoles(show.id);
    expect(roles.map(r => r.name)).toEqual(ROLE_PRESETS.map(p => p.name));
    for (const role of roles) {
      expect(role.code).toMatch(/^[A-Z0-9]{6}$/);
      expect(role.code).not.toMatch(AMBIGUOUS);
    }
    // Every key in one namespace, so the door can tell what you meant by what you typed.
    const keys = [show.id, ...roles.map(r => r.code)];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the newest first, the way the cloud list comes back", () => {
    const first = newLocalShow("Macbeth", null);
    const second = newLocalShow("Lear", null);
    expect(listLocalShows().map(s => s.id)).toEqual([second.id, first.id]);
  });

  it("takes an update in the shape the table takes", () => {
    const show = newLocalShow("Macbeth", "seq-1");
    updateLocalShow(show.id, { name: "Macbeth, dress", started_at: "2026-09-20T19:30:00.000Z" });
    const held = listLocalShows()[0];
    expect(held.name).toBe("Macbeth, dress");
    expect(held.startedAt).toBe("2026-09-20T19:30:00.000Z");
    expect(held.sequenceId).toBe("seq-1");
  });
});

describe("the door", () => {
  it("lets the show's own key in as a collaborator holding everything", () => {
    const show = newLocalShow("Macbeth", null);
    const ticket = joinLocalShow(show.id, "Sam");
    expect(ticket.host).toBe(true);
    expect(ticket.status).toBe("admitted");
    expect([...ticket.perms].sort()).toEqual(PERMS.map(p => p.key).sort());
    // The show's name, not the person's: that is what the crew screen prints as its heading.
    expect(ticket.name).toBe("Macbeth");
  });

  it("puts a job's key in that job and leaves it holding nothing", () => {
    const show = newLocalShow("Macbeth", null);
    const backstage = localRoles(show.id).find(r => r.name === "Backstage")!;
    const ticket = joinLocalShow(backstage.code!, "Ada");
    expect(ticket.role).toBe("Backstage");
    expect(ticket.host).toBe(false);
    expect(ticket.status).toBe("waiting");
    // A joiner writes its own seat, so it must not be able to write itself any powers.
    expect(ticket.perms).toEqual([]);
    expect(localPerms(ticket.member, show.id)).toEqual([]);
  });

  it("takes a key typed back in whatever case is to hand", () => {
    const show = newLocalShow("Macbeth", null);
    const display = localRoles(show.id).find(r => r.name === "Display")!;
    const ticket = joinLocalShow(`  ${display.code!.toLowerCase()} `, "Foyer TV");
    expect(ticket.role).toBe("Display");
  });

  it("says nothing goes by a key that is not here", () => {
    newLocalShow("Macbeth", null);
    expect(() => joinLocalShow("ZZZZZZ", "Nobody")).toThrow(/Nothing here goes by that key/);
  });

  it("knows which keys are its own to answer", () => {
    const show = newLocalShow("Macbeth", null);
    const role = localRoles(show.id)[0];
    expect(isLocalKey(show.id)).toBe(true);
    expect(isLocalKey(role.code!.toLowerCase())).toBe(true);
    expect(isLocalKey("ZZZZZZ")).toBe(false);
    expect(isLocalKey("   ")).toBe(false);
  });

  it("gives the same device its seat back rather than a second one", () => {
    const show = newLocalShow("Macbeth", null);
    const code = localRoles(show.id)[0].code!;
    const first = joinLocalShow(code, "Ada");
    const again = joinLocalShow(code, "Ada");
    // A refresh puts you back in the queue you were already in, under the id the host has seen.
    expect(again.member).toBe(first.member);
    expect(localRoster(show.id)).toHaveLength(1);
  });
});

describe("what the host says at the door", () => {
  it("is the only thing that writes a crew member's permissions", () => {
    const show = newLocalShow("Macbeth", null);
    const controller = localRoles(show.id).find(r => r.name === "Controller")!;
    const joined = joinLocalShow(controller.code!, "Ada");
    expect(localTicket(joined.member)!.perms).toEqual([]);

    rememberDoor(joined.member, show.id, "in", controller.name, controller.perms, "Ada");

    const back = localTicket(joined.member)!;
    expect(back.status).toBe("admitted");
    expect(back.role).toBe("Controller");
    expect(back.perms).toEqual(controller.perms);
    expect(localPerms(joined.member, show.id)).toContain("fire" as Perm);
  });

  it("withholds everything from a device still waiting or turned away", () => {
    const show = newLocalShow("Macbeth", null);
    const role = localRoles(show.id)[0];
    const joined = joinLocalShow(role.code!, "Ada");

    rememberDoor(joined.member, show.id, "waiting", role.name, role.perms, "Ada");
    expect(localTicket(joined.member)!.perms).toEqual([]);

    rememberDoor(joined.member, show.id, "out", role.name, role.perms, "Ada");
    const refused = localTicket(joined.member)!;
    expect(refused.status).toBe("denied");
    expect(refused.perms).toEqual([]);
  });

  it("writes a seat the host has never seen, because the joiner minted it elsewhere", () => {
    const show = newLocalShow("Macbeth", null);
    const role = localRoles(show.id)[0];
    // No `joinLocalShow` here: this is the host's device, where that member does not exist yet.
    rememberDoor("member-from-another-device", show.id, "in", role.name, role.perms, "Ada");
    expect(localPerms("member-from-another-device", show.id)).toEqual(role.perms);
    expect(localRoster(show.id).map(p => p.name)).toEqual(["Ada"]);
  });

  it("is worth nothing at a show it was not said about", () => {
    const here = newLocalShow("Macbeth", null);
    const elsewhere = newLocalShow("Lear", null);
    const role = localRoles(here.id)[0];
    const joined = joinLocalShow(role.code!, "Ada");
    rememberDoor(joined.member, here.id, "in", role.name, role.perms, "Ada");
    expect(localPerms(joined.member, elsewhere.id)).toEqual([]);
  });
});

describe("jobs", () => {
  it("refuses a key another job is already using", () => {
    const show = newLocalShow("Macbeth", null);
    const [first, second] = localRoles(show.id);
    expect(() => updateLocalRole(second.id, { code: first.code! })).toThrow(/already using that key/);
    // Saving a job's own key back is not a collision with itself.
    expect(() => updateLocalRole(second.id, { code: second.code! })).not.toThrow();
  });

  it("adds and removes a job of its own", () => {
    const show = newLocalShow("Macbeth", null);
    const spot = addLocalRole(show.id, "Followspot", ["cues"]);
    expect(localRoles(show.id)).toHaveLength(ROLE_PRESETS.length + 1);
    expect(isLocalKey(spot.code!)).toBe(true);
    deleteLocalRole(spot.id);
    expect(localRoles(show.id).some(r => r.id === spot.id)).toBe(false);
  });
});

describe("deleting a show", () => {
  it("takes its jobs and its roster with it", () => {
    const show = newLocalShow("Macbeth", null);
    const keep = newLocalShow("Lear", null);
    const role = localRoles(show.id)[0];
    const joined = joinLocalShow(role.code!, "Ada");

    deleteLocalShow(show.id);

    expect(listLocalShows().map(s => s.id)).toEqual([keep.id]);
    expect(localRoles(show.id)).toEqual([]);
    expect(localRoster(show.id)).toEqual([]);
    // A seat whose show is gone is not a ticket. Handing back half of one would leave a crew screen
    // waiting for a host that will never answer.
    expect(localTicket(joined.member)).toBeNull();
    // And the deleted show's keys stop answering the door.
    expect(isLocalKey(role.code!)).toBe(false);
  });
});
