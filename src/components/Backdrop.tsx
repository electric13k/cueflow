import { useEffect } from "react";

// Real animated WebGL shader: a slow flowing noise field in the cyan palette, behind every page.
const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FRAG = `
precision highp float;
uniform vec2 u_res; uniform float u_time;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); float a = hash(i), b = hash(i + vec2(1.0,0.0)), c = hash(i + vec2(0.0,1.0)), d = hash(i + vec2(1.0,1.0)); vec2 u = f*f*(3.0-2.0*f); return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for(int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.02; a *= 0.5; } return v; }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  vec2 p = uv; p.x *= u_res.x / u_res.y;
  float t = u_time * 0.04;
  float n = fbm(p * 3.0 + vec2(t, t*0.6) + fbm(p*2.0 - t) * 0.6);
  vec3 base = vec3(0.015, 0.03, 0.06);
  vec3 cyan = vec3(0.13, 0.83, 0.93);
  vec3 col = base + cyan * smoothstep(0.35, 0.95, n) * 0.30;
  col += cyan * 0.10 * smoothstep(0.9, 0.0, length(uv - vec2(0.5, 0.0)));
  col *= 1.0 - 0.28 * length(uv - 0.5);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s;
}

export default function Backdrop() {
  useEffect(() => {
    const canvas = document.getElementById("bg") as HTMLCanvasElement | null;
    const gl = canvas?.getContext("webgl", { antialias: false, depth: false });
    if (!canvas || !gl) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog); gl.useProgram(prog);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, "u_res"), uTime = gl.getUniformLocation(prog, "u_time");
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const resize = () => { canvas.width = innerWidth * dpr; canvas.height = innerHeight * dpr; gl.viewport(0, 0, canvas.width, canvas.height); };
    resize(); addEventListener("resize", resize);
    let raf = 0; const t0 = performance.now();
    const render = () => { gl.uniform2f(uRes, canvas.width, canvas.height); gl.uniform1f(uTime, (performance.now() - t0) / 1000); gl.drawArrays(gl.TRIANGLES, 0, 3); raf = requestAnimationFrame(render); };
    render();
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", resize); };
  }, []);
  return <canvas id="bg" aria-hidden className="fixed inset-0 -z-10 h-full w-full" />;
}
