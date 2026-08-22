import { useEffect, useRef } from "react";
import { DARK, useThemeSignal } from "../lib/theme";
import { useDeviceCapabilities } from "../lib/layout";

/**
 * The house wash behind every page: warm beige, a soft glow off the top as if the house lights are
 * up, the curtain's burgundy breathing in the upper corner and the crew's olive rising off the
 * floor. Dust in the beam over the top.
 *
 * A canvas gets no CSS, so the palette is read out of the document and handed to the shader as
 * uniforms, and re-read whenever the theme changes. The theme signal is the dependency that makes
 * that happen (src/lib/theme.ts).
 *
 * The shader paints an opaque field, so it mounts only when the page itself is light -- which is
 * now the default. If the whole document is put in dark, this stands down and the body gradient
 * takes over; a `.theme-dark` wrapper *inside* the page is a subtree, not the page, and leaves the
 * wash alone on purpose.
 *
 * The drift is deliberately slower than you can notice. A backdrop that competes with the cue deck
 * is a bug.
 */
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_time;
uniform vec3 u_bg, u_glow, u_curtain, u_audio;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 aspect = vec2(u_res.x / max(u_res.y, 1.0), 1.0);
  float t = u_time * 0.02;                              // one lap of the drift takes minutes
  vec2 house   = vec2(0.50 + 0.04 * sin(t), 1.06);      // the glow, off the top
  vec2 tabs    = vec2(0.90 + 0.03 * cos(t * 0.8), 0.92);// house tabs, upper corner
  vec2 floorPt = vec2(0.08 + 0.03 * cos(t * 0.7), -0.06);
  // Every wash is a mix toward a palette colour rather than an addition, because adding light to a
  // pale page only bleaches it: the tint has to replace paper, not sit on top of it.
  vec3 col = u_bg;
  col = mix(col, u_glow,    0.85 * smoothstep(1.30, 0.0, length((uv - house) * aspect)));
  col = mix(col, u_curtain, 0.13 * smoothstep(1.00, 0.0, length((uv - tabs) * aspect)));
  col = mix(col, u_audio,   0.10 * smoothstep(0.95, 0.0, length((uv - floorPt) * aspect)));
  col *= 1.0 - 0.045 * length(uv - 0.5);                // corners sit back, barely
  // Dust. Stepped in time so it settles instead of boiling, and equal on every channel so it
  // cannot tint anything.
  col += (hash(floor(gl_FragCoord.xy) + floor(u_time * 5.0)) - 0.5) * 0.016;
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s;
}

/** One palette token as 0..1 rgb. Falls back if the token is missing or not a hex. */
function tokenRgb(name: string, fallback: [number, number, number]): [number, number, number] {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const h = m[1].length === 3 ? m[1].replace(/./g, c => c + c) : m[1];
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

export default function Backdrop() {
  // Subscribing re-renders this component on every theme change, so reading the class here is
  // reading a value we are already synchronised to rather than sampling the DOM blind.
  const theme = useThemeSignal();
  const device = useDeviceCapabilities();
  const light = !document.documentElement.classList.contains(DARK);
  const animateBackdrop = light && !device.isPhone && !device.reducedMotion && !device.reducedData;
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!animateBackdrop) return;
    const el = canvas.current;
    const gl = el?.getContext("webgl", { antialias: false, depth: false });
    if (!el || !gl) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "u_res"), uTime = gl.getUniformLocation(prog, "u_time");
    // Palette, read from the document. This effect re-runs on every theme change, so these are
    // never stale, and they are the only colour in the shader.
    gl.uniform3fv(gl.getUniformLocation(prog, "u_bg"), tokenRgb("--background", [.953, .914, .847]));
    gl.uniform3fv(gl.getUniformLocation(prog, "u_glow"), tokenRgb("--cue-foolscap", [.984, .965, .925]));
    gl.uniform3fv(gl.getUniformLocation(prog, "u_curtain"), tokenRgb("--cue-curtain", [.431, .125, .161]));
    gl.uniform3fv(gl.getUniformLocation(prog, "u_audio"), tokenRgb("--cue-audio", [.275, .345, .227]));
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const resize = () => { el.width = innerWidth * dpr; el.height = innerHeight * dpr; gl.viewport(0, 0, el.width, el.height); };
    resize(); addEventListener("resize", resize);
    let raf = 0; const t0 = performance.now();
    const render = () => {
      gl.uniform2f(uRes, el.width, el.height);
      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      raf = requestAnimationFrame(render);
    };
    render();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, [animateBackdrop, theme]);

  if (!animateBackdrop) return null;
  return <canvas ref={canvas} id="bg" aria-hidden className="fixed inset-0 -z-10 h-full w-full" />;
}
