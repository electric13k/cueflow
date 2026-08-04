import { supabase, local } from "./store";

/**
 * Six characters, no 0/O/1/I/l. A code gets read aloud across a room more often than it gets typed,
 * and the pairs that sound or look alike are the ones that waste a minute at the door.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newCode = (n = 6) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), b => ALPHABET[b % ALPHABET.length]).join("");

export const CODE_RE = /^[a-zA-Z0-9]{4,12}$/;
export const codeProblem = (code: string) =>
  !code.trim() ? "A code cannot be empty."
  : !CODE_RE.test(code.trim()) ? "Letters and numbers only, 4 to 12 of them."
  : "";

export type Project = { id: string; name: string; code: string; owner: string; role: string };
export type Member = { userId: string; username: string | null; displayName: string | null; role: string };

const need = () => { if (!supabase) throw new Error("Cloud is not configured for this build."); return supabase; };
const me = async () => (await need().auth.getUser()).data.user;

/** The project a device is working in. Null is the personal library, which is what existed before. */
export const currentProject = () => local.get<string | null>("project", null);
export const setCurrentProject = (id: string | null) => local.set("project", id);

export async function listProjects(): Promise<Project[]> {
  if (!supabase) return [];
  const user = await me();
  if (!user) return [];
  const { data, error } = await supabase.from("projects").select("id,name,code,owner");
  if (error) throw new Error(error.message);
  return (data ?? []).map(p => ({ ...p, role: p.owner === user.id ? "owner" : "member" }));
}

export async function createProject(name: string): Promise<Project> {
  const user = await me();
  if (!user) throw new Error("Sign in to start a project.");
  // A collision is a unique-violation, not a silent overwrite; three tries covers it comfortably.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await need().from("projects")
      .insert({ name: name.trim() || "Untitled project", code: newCode(), owner: user.id })
      .select("id,name,code,owner").single();
    if (!error) return { ...data, role: "owner" };
    if (error.code !== "23505") throw new Error(error.message);
  }
  throw new Error("Could not find a free code. Try again.");
}

export async function updateProject(id: string, patch: { name?: string; code?: string }) {
  if (patch.code) {
    const problem = codeProblem(patch.code);
    if (problem) throw new Error(problem);
  }
  const { error } = await need().from("projects").update(patch).eq("id", id);
  if (error) throw new Error(error.code === "23505" ? "Another project already uses that code." : error.message);
}

export async function deleteProject(id: string) {
  const { error } = await need().from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/**
 * By username or by email address. The lookup runs server-side because profiles deliberately has no
 * email column -- being findable by name is the point, being enumerable by address is not.
 */
export async function addCollaborator(project: string, who: string, role: "editor" | "viewer") {
  const { error } = await need().rpc("add_collaborator", { p_project: project, p_who: who.trim(), p_role: role });
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));
}

export async function listMembers(project: string): Promise<Member[]> {
  const rows = await need().from("project_members").select("user_id,role").eq("project_id", project);
  if (rows.error) throw new Error(rows.error.message);
  const ids = (rows.data ?? []).map(r => r.user_id);
  if (!ids.length) return [];
  const { data: people } = await need().from("profiles").select("id,username,display_name").in("id", ids);
  return (rows.data ?? []).map(r => {
    const p = people?.find(x => x.id === r.user_id);
    return { userId: r.user_id, username: p?.username ?? null, displayName: p?.display_name ?? null, role: r.role };
  });
}

export async function removeMember(project: string, userId: string) {
  const { error } = await need().from("project_members").delete().eq("project_id", project).eq("user_id", userId);
  if (error) throw new Error(error.message);
}
