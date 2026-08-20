const fs = require("node:fs");
const path = require("node:path");

const out = path.resolve(__dirname, "../public/shots");
fs.mkdirSync(out, { recursive: true });

const palettes = {
  light: {
    bg: "#F4EEDF",
    ink: "#1B1714",
    paper: "#FFF9EF",
    brass: "#C1842D",
    olive: "#646941",
    wine: "#7D3434",
    mist: "#D8CBB8",
    glow: "#F5D88A",
  },
  dark: {
    bg: "#151311",
    ink: "#F3E7D4",
    paper: "#26211C",
    brass: "#D69A35",
    olive: "#8A8C55",
    wine: "#A4514D",
    mist: "#6B5D4D",
    glow: "#E8B64A",
  },
};

function shell(theme, content, portrait = false) {
  const p = palettes[theme];
  const width = portrait ? 900 : 1600;
  const height = portrait ? 1600 : 900;
  const noise = `${theme}-${portrait ? "portrait" : "wide"}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cueflow abstract production graphic">
  <defs>
    <linearGradient id="bg-${noise}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.bg}"/>
      <stop offset="1" stop-color="${p.paper}"/>
    </linearGradient>
    <linearGradient id="gold-${noise}" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${p.brass}"/>
      <stop offset=".5" stop-color="${p.glow}"/>
      <stop offset="1" stop-color="${p.brass}"/>
    </linearGradient>
    <filter id="shadow-${noise}" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="${theme === "dark" ? "#000000" : "#5D4933"}" flood-opacity=".22"/>
    </filter>
    <filter id="soft-${noise}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="24"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bg-${noise})"/>
  ${content}
</svg>`;
}

function cueRail(theme, portrait) {
  const p = palettes[theme];
  const wide = !portrait;
  const line = wide ? "M120 500 C360 470 520 520 760 490 S1180 450 1480 490" : "M450 150 C420 360 490 510 450 720 S420 1120 460 1450";
  const dots = wide
    ? [[360, 500, p.olive], [650, 494, p.brass], [930, 478, p.wine], [1210, 470, p.ink]]
    : [[450, 360, p.olive], [450, 630, p.brass], [450, 900, p.wine], [450, 1170, p.ink]];
  const wave = wide ? "M80 680 C180 600 240 760 340 680 S500 600 600 680 S760 760 860 680 S1020 600 1120 680 S1280 760 1520 640" : "M220 1380 C130 1260 300 1180 220 1060 S130 860 230 740 S300 510 220 300";
  return shell(theme, `
    <path d="M0 ${wide ? 180 : 0} Q${wide ? 500 : 450} ${wide ? 380 : 220} ${wide ? 980 : 900} ${wide ? 120 : 480} T${wide ? 1600 : 900} ${wide ? 200 : 880}" fill="${p.paper}" opacity=".72"/>
    <path d="${wide ? "M0 700 Q360 560 690 720 T1600 650" : "M90 0 Q560 280 720 640 T700 1600"}" fill="none" stroke="${p.olive}" stroke-width="120" opacity=".18"/>
    <path d="${line}" fill="none" stroke="url(#gold-${theme}-${wide ? "wide" : "portrait"})" stroke-width="16" stroke-linecap="round"/>
    ${dots.map(([x, y, fill]) => `<circle cx="${x}" cy="${y}" r="58" fill="${fill}" stroke="${p.ink}" stroke-width="10" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/><circle cx="${x - 18}" cy="${y - 18}" r="12" fill="${p.paper}" opacity=".55"/>`).join("")}
    <path d="${wave}" fill="none" stroke="${p.ink}" stroke-width="9" opacity=".32"/>
    <path d="${wave}" fill="none" stroke="${p.mist}" stroke-width="3" opacity=".9" transform="translate(0 18)"/>
    <circle cx="${wide ? 1360 : 650}" cy="${wide ? 220 : 1240}" r="${wide ? 120 : 100}" fill="${p.brass}" opacity=".13" filter="url(#soft-${theme}-${wide ? "wide" : "portrait"})"/>
  `, portrait);
}

function pulse(theme, portrait) {
  const p = palettes[theme];
  const wide = !portrait;
  const wave = wide ? "M60 470 C140 260 230 680 320 470 S500 260 590 470 S770 680 860 470 S1040 260 1130 470 S1310 680 1540 430" : "M460 100 C240 180 680 300 460 420 S240 660 460 780 S680 1020 460 1140 S240 1360 460 1500";
  const cx = wide ? 800 : 450;
  const cy = wide ? 450 : 780;
  return shell(theme, `
    <path d="${wide ? "M0 170 Q330 360 660 160 T1600 220" : "M130 0 Q500 260 240 590 T700 1200 Q820 1450 640 1600"}" fill="none" stroke="${p.wine}" stroke-width="180" opacity=".14"/>
    <path d="${wide ? "M80 720 Q420 580 720 760 T1540 690" : "M760 40 Q540 330 740 600 T250 1150 Q100 1390 300 1600"}" fill="none" stroke="${p.olive}" stroke-width="120" opacity=".25"/>
    <path d="${wave}" fill="none" stroke="${p.brass}" stroke-width="24" stroke-linecap="round" opacity=".95"/>
    <path d="${wave}" fill="none" stroke="${p.paper}" stroke-width="4" stroke-linecap="round" opacity=".9" transform="translate(0 28)"/>
    <circle cx="${cx}" cy="${cy}" r="${wide ? 150 : 142}" fill="${p.paper}" stroke="${p.brass}" stroke-width="18" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/>
    <circle cx="${cx}" cy="${cy}" r="${wide ? 116 : 106}" fill="${p.bg}" stroke="${p.olive}" stroke-width="4"/>
    <path d="M${cx - 24} ${cy - 48} L${cx + 60} ${cy} L${cx - 24} ${cy + 48} Z" fill="${p.brass}"/>
    <circle cx="${wide ? 1300 : 240}" cy="${wide ? 170 : 1320}" r="68" fill="${p.wine}" opacity=".9"/>
    <circle cx="${wide ? 1410 : 650}" cy="${wide ? 680 : 180}" r="46" fill="${p.olive}" opacity=".9"/>
  `, portrait);
}

function stage(theme, portrait) {
  const p = palettes[theme];
  const wide = !portrait;
  const base = wide ? { x: 420, y: 640, w: 760, h: 56 } : { x: 210, y: 1300, w: 480, h: 48 };
  const beams = wide
    ? [[430, 80, 680, 630], [800, 40, 800, 640], [1170, 80, 920, 630]]
    : [[160, 80, 400, 1240], [450, 0, 450, 1260], [740, 80, 500, 1240]];
  return shell(theme, `
    <rect width="${wide ? 1600 : 900}" height="${wide ? 900 : 1600}" fill="${p.ink}" opacity=".12"/>
    ${beams.map(([x1, y1, x2, y2]) => `<path d="M${x1} ${y1} L${x2 - 100} ${y2} L${x2 + 100} ${y2} Z" fill="${p.glow}" opacity=".16"/>`).join("")}
    <rect x="${wide ? 520 : 280}" y="${wide ? 400 : 800}" width="${wide ? 160 : 120}" height="${wide ? 240 : 420}" rx="${wide ? 18 : 14}" fill="${p.brass}" opacity=".72" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/>
    <rect x="${wide ? 790 : 400}" y="${wide ? 300 : 650}" width="${wide ? 210 : 120}" height="${wide ? 340 : 520}" rx="${wide ? 18 : 14}" fill="${p.paper}" opacity=".84" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/>
    <rect x="${wide ? 1090 : 560}" y="${wide ? 440 : 900}" width="${wide ? 130 : 110}" height="${wide ? 200 : 320}" rx="${wide ? 18 : 14}" fill="${p.wine}" opacity=".72" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/>
    <rect x="${base.x}" y="${base.y}" width="${base.w}" height="${base.h}" rx="28" fill="${p.brass}"/>
    <path d="${wide ? "M260 760 C430 680 540 820 700 740 S980 680 1140 760 S1340 800 1430 730" : "M190 1460 C300 1360 380 1500 460 1410 S620 1300 720 1400"}" fill="none" stroke="${p.mist}" stroke-width="9" opacity=".7"/>
    <circle cx="${wide ? 1340 : 690}" cy="${wide ? 190 : 220}" r="${wide ? 100 : 74}" fill="${p.glow}" opacity=".22" filter="url(#soft-${theme}-${wide ? "wide" : "portrait"})"/>
  `, portrait);
}

function crew(theme, portrait) {
  const p = palettes[theme];
  const wide = !portrait;
  const nodes = wide ? [[300, 300], [800, 170], [1260, 300], [800, 700]] : [[450, 220], [230, 620], [670, 620], [450, 1060]];
  const edges = [[0, 1], [1, 2], [0, 3], [2, 3]];
  return shell(theme, `
    <path d="${wide ? "M200 700 Q800 80 1400 700" : "M450 120 Q80 620 450 1480 Q820 620 450 120"}" fill="none" stroke="${p.paper}" stroke-width="38" opacity=".42"/>
    ${edges.map(([a, b]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[b][0]}" y2="${nodes[b][1]}" stroke="${p.brass}" stroke-width="12" opacity=".8"/>`).join("")}
    ${nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${wide ? 92 : 84}" fill="${[p.brass, p.olive, p.wine, p.paper][i]}" stroke="${p.ink}" stroke-width="12" filter="url(#shadow-${theme}-${wide ? "wide" : "portrait"})"/><circle cx="${x - 24}" cy="${y - 24}" r="18" fill="${p.paper}" opacity=".52"/><circle cx="${x}" cy="${y}" r="${wide ? 126 : 112}" fill="none" stroke="${p.mist}" stroke-width="3" opacity=".48"/>`).join("")}
    <path d="${wide ? "M80 120 Q350 40 560 120" : "M120 300 Q450 60 780 300"}" fill="none" stroke="${p.wine}" stroke-width="22" opacity=".6"/>
    <circle cx="${wide ? 1450 : 760}" cy="${wide ? 720 : 1420}" r="${wide ? 64 : 52}" fill="${p.olive}" opacity=".9"/>
  `, portrait);
}

for (const theme of ["light", "dark"]) {
  for (const portrait of [false, true]) {
    const suffix = portrait ? "-phone" : "";
    fs.writeFileSync(path.join(out, `cue-rail${suffix}-${theme}.svg`), cueRail(theme, portrait));
    fs.writeFileSync(path.join(out, `pulse${suffix}-${theme}.svg`), pulse(theme, portrait));
    fs.writeFileSync(path.join(out, `stage${suffix}-${theme}.svg`), stage(theme, portrait));
    fs.writeFileSync(path.join(out, `crew${suffix}-${theme}.svg`), crew(theme, portrait));
  }
}
