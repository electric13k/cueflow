This directory is what a baked installer carries.

An ordinary CueFlow installer ships with nothing in here but this file. Running
`node scripts/bake-show.mjs <show.cueflow>` drops the show next to it as
show.cueflow, and the app finds it at first start and opens already holding that
production and the job the pack was cut for.

This file exists so the directory is never empty. Tauri's bundler fails a build
whose resource glob matches nothing, and an empty directory does not survive git.
