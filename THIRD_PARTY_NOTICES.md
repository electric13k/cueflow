# Third-party notices

CueFlow includes or uses the following open-source projects in its browser editor workflows. The corresponding upstream license files and package versions should be retained with every release.

| Project | Role in CueFlow | License or notice | Upstream |
|---|---|---|---|
| React | Application runtime | MIT | https://github.com/facebook/react |
| Vite | Build and development tooling | MIT | https://github.com/vitejs/vite |
| HeroUI | Accessible interface primitives | MIT | https://github.com/heroui-inc/heroui |
| Lucide | Interface icons | ISC | https://github.com/lucide-icons/lucide |
| wavesurfer.js | Audio waveform, regions, timeline, envelope and playback visualization | BSD-3-Clause | https://github.com/katspaugh/wavesurfer.js |
| Cropper.js | Image crop and transform interaction | MIT | https://github.com/fengyuanchen/cropperjs |
| FFmpeg.wasm | Client-side video rendering worker | MIT wrapper; the bundled FFmpeg core carries its own applicable license and notices | https://github.com/ffmpegwasm/ffmpeg.wasm |
| FFmpeg | Video processing runtime used through FFmpeg.wasm | Verify the selected core build license and codec notices at release time | https://ffmpeg.org/ |

CueFlow’s PowerPoint export uses a small self-contained Open XML adapter built on its own ZIP writer and the existing CueFlow slide model. It does not copy PptxGenJS or other third-party PowerPoint source code. The existing `pptWeb` entry on the Credits page is a design and behavior reference, not bundled code.

CueFlow also uses browser standards including Web Audio, Canvas, MediaSource where available, Web Workers, and the File and Blob APIs. These are platform APIs and are not third-party dependencies.

License metadata and exact versions should be checked against the lockfile and installed package license files whenever dependencies change. This notice is a project attribution record, not legal advice.
