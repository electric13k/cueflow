//! The two things the Wi-Fi half of the mesh needs from Android that Rust cannot ask for directly.
//!
//! Android drops multicast frames before they reach a socket unless the app is holding a
//! `WifiManager.MulticastLock`. That lock is a Java object with no NDK equivalent, so the only way
//! to take it from Rust is through JNI. Without it, a phone hears the per-interface broadcast
//! beacons and misses the multicast ones, which usually still works and occasionally does not:
//! some access points block directed broadcast between clients while passing multicast, and on
//! those the phone is invisible to the rest of the room with no error anywhere.
//!
//! Everything here is best effort. A failure is logged and the mesh carries on with broadcast only,
//! because a lock that could not be taken is a worse discovery path, not a broken show.

#![cfg(target_os = "android")]

use anyhow::{anyhow, Result};
use jni::objects::{JObject, JValue};
use jni::JavaVM;

/// Keeps the multicast lock alive. Dropping it releases the lock, which is the point: the radio
/// filter is expensive on battery and a phone that has left the show should not keep paying for it.
pub struct MulticastLock {
    vm: JavaVM,
    lock: jni::objects::GlobalRef,
}

impl Drop for MulticastLock {
    fn drop(&mut self) {
        let Ok(mut env) = self.vm.attach_current_thread_permanently() else { return };
        if let Err(error) = env.call_method(&self.lock, "release", "()V", &[]) {
            tracing::debug!("could not release the multicast lock: {error}");
        }
    }
}

/// Take a `MulticastLock` for as long as the returned value is held.
///
/// `ndk_context` is populated by the Android glue that Tauri starts the app through. If it is not
/// set, this is running somewhere that glue never ran, and there is nothing to attach to.
pub fn hold_multicast_lock(tag: &str) -> Result<MulticastLock> {
    let context = ndk_context::android_context();
    if context.vm().is_null() || context.context().is_null() {
        return Err(anyhow!("No Android context, so no multicast lock. Discovery will use broadcast only."));
    }

    // Safety: these pointers come from the Android glue that started this process and are valid for
    // the life of the app. There is no safe way to obtain them; this is the documented use.
    let vm = unsafe { JavaVM::from_raw(context.vm().cast()) }?;
    let activity = unsafe { JObject::from_raw(context.context().cast()) };

    let mut env = vm.attach_current_thread_permanently()?;

    // `WIFI_SERVICE` must be looked up from the application context. Asking the activity directly
    // leaks the activity on some releases, which the lint in the Android docs is explicit about.
    let app = env
        .call_method(&activity, "getApplicationContext", "()Landroid/content/Context;", &[])?
        .l()?;
    let service_name = env.new_string("wifi")?;
    let wifi = env
        .call_method(
            &app,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::Object(&service_name)],
        )?
        .l()?;
    if wifi.is_null() {
        return Err(anyhow!("This device reported no Wi-Fi service, so multicast cannot be unblocked."));
    }

    let tag = env.new_string(tag)?;
    let lock = env
        .call_method(
            &wifi,
            "createMulticastLock",
            "(Ljava/lang/String;)Landroid/net/wifi/WifiManager$MulticastLock;",
            &[JValue::Object(&tag)],
        )?
        .l()?;

    // Not reference counted: acquire and release are then symmetric, and a double acquire cannot
    // leave the lock held after the show has ended.
    env.call_method(&lock, "setReferenceCounted", "(Z)V", &[JValue::Bool(0)])?;
    env.call_method(&lock, "acquire", "()V", &[])?;

    let lock = env.new_global_ref(lock)?;
    Ok(MulticastLock { vm, lock })
}
