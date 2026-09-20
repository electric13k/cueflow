// Release builds get no console window. A stage manager double-clicking CueFlow should see the show,
// not a black box behind it; `RUST_LOG` plus a debug build is how the detail comes back when it is
// wanted.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    cueflow_lib::run();
}
