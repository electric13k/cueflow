/// `ble_peripheral` is on wherever a Rust crate can host a GATT server.
///
/// It is a cfg rather than a cargo feature on purpose: a feature would have to be switched off by
/// hand for the Android build, and the first time someone forgot, the Android build would stop
/// compiling for a reason that had nothing to do with their change. Deriving it from the target
/// means the two builds cannot be configured wrongly relative to each other.
fn main() {
    println!("cargo::rustc-check-cfg=cfg(ble_peripheral)");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if matches!(target.as_str(), "windows" | "macos" | "linux") {
        println!("cargo::rustc-cfg=ble_peripheral");
    }
    tauri_build::build();
}
