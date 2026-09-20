//! What the offline app keeps on this machine.
//!
//! The mesh works and the show could not survive a reload. `uploadTrack` on the page side gave
//! every import either a `blob:` URL, which belongs to one document and dies with it, or a Supabase
//! Storage `https:` URL, which is a name for bytes on the far side of the connection the venue does
//! not have. So the one thing the native build exists for, a room with no internet, opened with a
//! full cue list and no sound.
//!
//! What lives here is exactly the show, its sequences and its assets. Nothing else. A front of
//! house machine is shared and usually not the operator's, so anything kept on it that is not
//! needed to call cues is something the next person can read.
//!
//! ```text
//! <app data>/shows/<id>.json        one document: the show, its jobs, its sequences, its script
//! <app data>/assets/<sha256>.<ext>  the media, under the hash of its own bytes
//! ```
//!
//! Content addressed rather than randomly named, for two reasons. The same sound imported twice is
//! one file. And a hash is the only name for a sound that means the same thing on two different
//! devices, which is what a cue travelling across the mesh needs it to be.

use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tracing::warn;

#[derive(Clone, serde::Serialize)]
pub struct AssetInfo {
    pub hash: String,
    pub ext: String,
    pub bytes: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct SweepReport {
    pub removed: usize,
    pub freed: u64,
}

#[derive(Clone, serde::Serialize)]
pub struct Usage {
    pub shows: usize,
    pub assets: usize,
    pub bytes: u64,
}

// -------------------------------------------------------------------------------------------
// Names
// -------------------------------------------------------------------------------------------

/// A hash is 64 lowercase hex characters and nothing else.
///
/// Every one of these names becomes a path, and a path is built by joining it onto the store root.
/// A name carrying `..`, a separator or a drive letter turns a cue import into a write anywhere the
/// operator can write. Lowercase is required rather than normalised so that one set of bytes cannot
/// arrive under two spellings and be stored twice.
pub fn hash_is_safe(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// An extension is 1 to 8 ASCII alphanumerics. No dot, no case folding, no empty string.
pub fn ext_is_safe(ext: &str) -> bool {
    !ext.is_empty() && ext.len() <= 8 && ext.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// A show id is the readable code the page mints, `CF-` and six characters, and it is also a
/// filename. Letters, digits, `-`, `_` and `.`, never a bare `.` or `..`, never a separator.
pub fn show_id_is_safe(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id != "."
        && id != ".."
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
}

/// The filename for a validated pair. Callers must have checked both first; this does not.
pub fn asset_name(hash: &str, ext: &str) -> String {
    format!("{hash}.{ext}")
}

/// Split `<hash>.<ext>` back apart, and only when both halves are ones we would have written.
///
/// Anything else in the folder was not put there by this app, and a sweep that counted it would
/// report freeing bytes it never owned.
pub fn split_asset_name(name: &str) -> Option<(String, String)> {
    let (hash, ext) = name.rsplit_once('.')?;
    (hash_is_safe(hash) && ext_is_safe(ext)).then(|| (hash.to_string(), ext.to_string()))
}

/// Whether a sweep keeps this file. Separate from the filesystem so a test can check the decision
/// without a disk, since deleting the wrong thing here is deleting a show's sound.
pub fn sweep_keeps(name: &str, keep: &[String]) -> bool {
    match split_asset_name(name) {
        // Not ours. Left alone rather than tidied away: this app did not write it and has no idea
        // what it is.
        None => true,
        Some((hash, _)) => keep.iter().any(|k| k == &hash),
    }
}

// -------------------------------------------------------------------------------------------
// Where it all lives
// -------------------------------------------------------------------------------------------

fn root(app: &AppHandle) -> Result<PathBuf> {
    app.path().app_data_dir().map_err(|e| anyhow!("This device would not say where an app may keep its files: {e}"))
}

fn dir(app: &AppHandle, leaf: &str) -> Result<PathBuf> {
    let path = root(app)?.join(leaf);
    fs::create_dir_all(&path)?;
    Ok(path)
}

fn assets_dir(app: &AppHandle) -> Result<PathBuf> {
    dir(app, "assets")
}
fn shows_dir(app: &AppHandle) -> Result<PathBuf> {
    dir(app, "shows")
}

fn sha256_of(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// What the webview is given for a file on disk. It passes this through `convertFileSrc`, which is
/// the only way a page is allowed to read one.
fn served(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

// -------------------------------------------------------------------------------------------
// Commands
// -------------------------------------------------------------------------------------------

/// Write bytes under the hash of those bytes, and refuse if they are not.
///
/// The check is the point. The name is what a cue points at, so a store whose names lie about their
/// contents is one where two different sounds collide on one cue and the wrong thing plays in front
/// of an audience. Cheap insurance: a hash of a file we are about to write to disk anyway.
#[tauri::command]
pub async fn store_put_asset(app: AppHandle, hash: String, ext: String, bytes: Vec<u8>) -> Result<String, String> {
    if !hash_is_safe(&hash) {
        return Err("That is not a content hash, so it is not a name this store will write under.".into());
    }
    if !ext_is_safe(&ext) {
        return Err("That file extension is not one this store will write.".into());
    }
    let actual = sha256_of(&bytes);
    if actual != hash {
        return Err("Those bytes do not hash to the name they were handed under, so they were not written.".into());
    }

    let path = assets_dir(&app).map_err(|e| e.to_string())?.join(asset_name(&hash, &ext));
    // An existing file at a content addressed path already holds exactly these bytes. Rewriting it
    // is wasted IO on a machine that may be a cheap tablet, not a conflict to resolve.
    if !path.exists() {
        fs::write(&path, &bytes).map_err(|e| format!("That sound could not be saved on this device: {e}"))?;
    }
    Ok(served(&path))
}

/// Where a hash plays from, or nothing when this device does not have those bytes.
///
/// The extension is not passed in, because the thing asking is a cue that knows only the hash. One
/// directory listing is cheaper than making every caller remember the extension it imported with.
#[tauri::command]
pub async fn store_asset_url(app: AppHandle, hash: String) -> Result<Option<String>, String> {
    if !hash_is_safe(&hash) {
        return Ok(None);
    }
    let dir = assets_dir(&app).map_err(|e| e.to_string())?;
    let found = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .find(|entry| {
            split_asset_name(&entry.file_name().to_string_lossy()).map(|(h, _)| h == hash).unwrap_or(false)
        });
    Ok(found.map(|entry| served(&entry.path())))
}

#[tauri::command]
pub async fn store_list_assets(app: AppHandle) -> Result<Vec<AssetInfo>, String> {
    let dir = assets_dir(&app).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some((hash, ext)) = split_asset_name(&name) else { continue };
        let bytes = entry.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(AssetInfo { hash, ext, bytes });
    }
    Ok(out)
}

#[tauri::command]
pub async fn store_save_show(app: AppHandle, id: String, json: String) -> Result<(), String> {
    if !show_id_is_safe(&id) {
        return Err("That show id is not one this store will write to disk.".into());
    }
    let path = shows_dir(&app).map_err(|e| e.to_string())?.join(format!("{id}.json"));
    // Written beside and renamed, because the realistic end to a night in a venue is somebody
    // pulling the power, and a half written show file is a show that will not open in the morning.
    let temp = path.with_extension("json.part");
    fs::write(&temp, json.as_bytes()).map_err(|e| format!("The show could not be saved: {e}"))?;
    fs::rename(&temp, &path).map_err(|e| format!("The show could not be saved: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn store_load_show(app: AppHandle, id: String) -> Result<Option<String>, String> {
    if !show_id_is_safe(&id) {
        return Ok(None);
    }
    let path = shows_dir(&app).map_err(|e| e.to_string())?.join(format!("{id}.json"));
    match fs::read_to_string(&path) {
        Ok(json) => Ok(Some(json)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("That show is on this device but would not open: {error}")),
    }
}

#[tauri::command]
pub async fn store_list_shows(app: AppHandle) -> Result<Vec<String>, String> {
    let dir = shows_dir(&app).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name.strip_suffix(".json") else { continue };
        if show_id_is_safe(id) {
            out.push(id.to_string());
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
pub async fn store_delete_show(app: AppHandle, id: String) -> Result<(), String> {
    if !show_id_is_safe(&id) {
        return Err("That show id is not one this store knows.".into());
    }
    let path = shows_dir(&app).map_err(|e| e.to_string())?.join(format!("{id}.json"));
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        // Already gone is the outcome the caller wanted.
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("That show could not be deleted: {error}")),
    }
}

/// Delete every asset no show still points at.
///
/// This is what makes "the offline app keeps the show, the sequences and the assets, and nothing
/// else" true rather than a thing we say. Without it the folder only ever grows, and a tablet that
/// has run thirty shows is a tablet with thirty shows' worth of sound on it and no way to tell.
///
/// The keep list is the caller's judgement and is taken as given. Working out what is still in use
/// needs the library and the sequences, which this side has no business parsing.
#[tauri::command]
pub async fn store_sweep(app: AppHandle, keep: Vec<String>) -> Result<SweepReport, String> {
    let dir = assets_dir(&app).map_err(|e| e.to_string())?;
    let mut removed = 0usize;
    let mut freed = 0u64;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if sweep_keeps(&name, &keep) {
            continue;
        }
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        match fs::remove_file(entry.path()) {
            Ok(()) => {
                removed += 1;
                freed += size;
            }
            // One file the operating system will not let go of does not make the sweep a failure.
            // Reported and stepped over, so the rest of the space is still recovered.
            Err(error) => warn!("{name} could not be deleted: {error}"),
        }
    }
    Ok(SweepReport { removed, freed })
}

#[tauri::command]
pub async fn store_usage(app: AppHandle) -> Result<Usage, String> {
    let assets = store_list_assets(app.clone()).await?;
    let shows = store_list_shows(app).await?;
    Ok(Usage { shows: shows.len(), assets: assets.len(), bytes: assets.iter().map(|a| a.bytes).sum() })
}

/// The name a baked installer carries its show under, inside the bundle's resource directory.
///
/// Two spellings are tried at runtime rather than one. Tauri's resource globs keep the relative
/// path they were listed under, so `resources/*` lands the file at `resources/show.cueflow`, while
/// a build that lists the file on its own puts it at the root. Trying both costs one `exists` call
/// at startup and removes a whole class of "the installer built and the show is not in it".
const BAKED: [&str; 2] = ["resources/show.cueflow", "show.cueflow"];

/// The show this installer was built around, if it was built around one.
///
/// A generic download is an empty app somebody then has to get a show into, which in a venue with
/// no internet means a USB stick and a file picker in a dark room. A baked installer is the show:
/// the crew member installs one file and the app opens already knowing the production and already
/// holding the job that person does. See `scripts/bake-show.mjs`, which is what puts the file here.
///
/// `None` rather than an error when there is nothing baked, because that is the normal case: every
/// installer on the releases page is a generic one, and an error there would be noise at every
/// single startup. A zero-length file counts as nothing, since that is what a placeholder is.
#[tauri::command]
pub async fn store_baked_show(app: AppHandle) -> Result<Option<Vec<u8>>, String> {
    let dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(error) => {
            warn!("this build has no resource directory: {error}");
            return Ok(None);
        }
    };
    for name in BAKED {
        let path = dir.join(name);
        match fs::read(&path) {
            Ok(bytes) if !bytes.is_empty() => return Ok(Some(bytes)),
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => warn!("a baked show at {} could not be read: {error}", path.display()),
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    const GOOD: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

    #[test]
    fn a_name_that_is_not_a_hash_is_refused() {
        assert!(hash_is_safe(GOOD));
        assert!(!hash_is_safe(&GOOD.to_uppercase()), "one set of bytes must not have two spellings");
        assert!(!hash_is_safe(&GOOD[..63]));
        assert!(!hash_is_safe(&format!("{GOOD}0")));
        assert!(!hash_is_safe(""));
        assert!(!hash_is_safe(".."));
        assert!(!hash_is_safe("../../etc/passwd"));
        // 64 characters, but g is not hex.
        assert!(!hash_is_safe(&"g".repeat(64)));
    }

    #[test]
    fn an_extension_that_could_be_a_path_is_refused() {
        assert!(ext_is_safe("mp3"));
        assert!(ext_is_safe("webm"));
        assert!(!ext_is_safe(""));
        assert!(!ext_is_safe("mp3/../x"));
        assert!(!ext_is_safe(".mp3"));
        assert!(!ext_is_safe("toolongextension"));
    }

    #[test]
    fn a_show_id_that_could_escape_the_folder_is_refused() {
        assert!(show_id_is_safe("CF-K7QM2X"));
        assert!(!show_id_is_safe(".."));
        assert!(!show_id_is_safe("."));
        assert!(!show_id_is_safe("../secrets"));
        assert!(!show_id_is_safe("a/b"));
        assert!(!show_id_is_safe("a\\b"));
        assert!(!show_id_is_safe(""));
    }

    #[test]
    fn a_validated_name_stays_inside_the_folder() {
        let root = Path::new("/store/assets");
        let joined = root.join(asset_name(GOOD, "mp3"));
        assert!(joined.starts_with(root));
        assert_eq!(joined.file_name().unwrap().to_string_lossy(), format!("{GOOD}.mp3"));
    }

    #[test]
    fn a_name_round_trips_and_a_foreign_one_does_not() {
        assert_eq!(split_asset_name(&asset_name(GOOD, "mp3")), Some((GOOD.to_string(), "mp3".to_string())));
        assert_eq!(split_asset_name("notes.txt"), None);
        assert_eq!(split_asset_name(GOOD), None);
    }

    #[test]
    fn a_sweep_removes_what_is_not_named_and_never_touches_what_is_not_ours() {
        let keep = vec![GOOD.to_string()];
        let other = "a".repeat(64);
        assert!(sweep_keeps(&asset_name(GOOD, "mp3"), &keep));
        assert!(!sweep_keeps(&asset_name(&other, "wav"), &keep));
        // Somebody else's file in the same folder is left exactly where it is.
        assert!(sweep_keeps("README.txt", &keep));
        assert!(sweep_keeps("keystore.jks", &keep));
    }

    #[test]
    fn an_empty_keep_list_clears_only_our_own_files() {
        assert!(!sweep_keeps(&asset_name(GOOD, "mp3"), &[]));
        assert!(sweep_keeps("something-else", &[]));
    }

    #[test]
    fn the_hash_is_the_one_the_page_computes() {
        // The SHA-256 of no bytes at all, which is the value every implementation agrees on and so
        // the cheapest check that this side and `crypto.subtle` on the page mean the same thing.
        assert_eq!(sha256_of(b""), GOOD);
        assert_eq!(
            sha256_of(b"cueflow"),
            sha256_of(b"cueflow"),
            "the same bytes must always produce the same name"
        );
        assert_ne!(sha256_of(b"cue"), sha256_of(b"cues"));
    }
}
