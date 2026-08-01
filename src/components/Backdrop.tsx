import { useEffect } from "react";

// WebGL wash + radial glow behind every page.
export default function Backdrop() {
  useEffect(() => {
    const canvas = document.getElementById("bg") as HTMLCanvasElement | null;
    const gl = canvas?.getContext("webgl");
    if (!canvas || !gl) return;
    let raf = 0;
    const render = () => { canvas.width = innerWidth; canvas.height = innerHeight; gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(.02, .035, .08, 1); gl.clear(gl.COLOR_BUFFER_BIT); raf = requestAnimationFrame(render); };
    render();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <><canvas id="bg" aria-hidden className="fixed inset-0 -z-10 h-full w-full" /><div aria-hidden className="fixed inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(34,211,238,.14),transparent)]" /></>;
}
