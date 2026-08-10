/**
 * Who is in a project and what that buys them. This is not a second permission model beside the
 * show one in `shows.ts`: a show hands out six switches per job because a followspot needs the cue
 * list and nothing else, while a project is coarse by design, so the three roles here are exactly
 * the three the database already enforces. `projects.owner` is the owner and
 * `project_members.role` is checked against ('editor', 'viewer'); everything below is that same
 * grid written once, so the page can ask the question the policy is about to ask anyway.
 */
export const ROLES = [
  { key: "editor", label: "Editor", hint: "Adds and changes sounds, sequences and shows." },
  { key: "viewer", label: "Viewer", hint: "Sees all of it, changes none of it." },
] as const;

export type Role = typeof ROLES[number]["key"];
/** The owner is not a row in the roster, so it is a role the UI knows and the roster never stores. */
export type ProjectRole = Role | "owner";

export const isRole = (value: string): value is Role => ROLES.some(r => r.key === value);
export const roleLabel = (value: string) => ROLES.find(r => r.key === value)?.label ?? "Owner";

/**
 * The policies in one function. Reading takes any role at all, writing takes owner or editor
 * (`project_role(...) = any('{owner,editor}')` on tracks and sequences), and the roster belongs to
 * the owner alone. Answering here is a courtesy to the person clicking, not a gate: the gate is RLS.
 */
export function can(role: ProjectRole | null, what: "read" | "write" | "manage"): boolean {
  if (!role) return false;
  if (what === "manage") return role === "owner";
  if (what === "write") return role !== "viewer";
  return true;
}

// profiles.username_shape, and the plainest address check that rejects what a person mistypes.
const USERNAME = /^[a-zA-Z][a-zA-Z0-9_]{2,19}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * The one box takes either, so it has to recognise both before spending a round trip. An @ means
 * they meant an address and a typo in one should say so, rather than coming back as the far more
 * alarming "no one here goes by that name".
 */
export function whoProblem(who: string): string {
  const id = who.trim();
  if (!id) return "Type a username or an email address.";
  if (id.includes("@")) return EMAIL.test(id) ? "" : "That does not look like an email address.";
  return USERNAME.test(id) ? "" : "A username is 3 to 20 letters, numbers or underscores, starting with a letter.";
}

/** Adding someone already on the roster is an accident worth catching before the round trip. */
export const alreadyThere = (members: { username: string | null }[], who: string) =>
  !who.includes("@") && members.some(m => m.username?.toLowerCase() === who.trim().toLowerCase());
