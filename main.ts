// THE WORLD TODAY — one image that sums up the world news of Thursday 19 November 2026.
//
// A program/v1 entry for make.fun's news-image-20261119 competition (Node, standard library
// only, no network). It draws a newspaper front page for that day — masthead, the day's lead
// story, four more stories with their own drawn pictures, and an "also today" strip — into a
// pixel buffer, encodes it as a PNG and writes it to /output/entry.png. Every fact on the page
// is a story that happened, or was first reported, on 19 November 2026. The drawing is fully
// deterministic: two runs write the same bytes.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { FONTS } from './font.mjs';

// ---------------------------------------------------------------------------
// Frame buffer: design space is 1024x1024, rendered at 2x and box-downsampled
// so edges and text come out smooth.
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const SS = 2;
const SW = W * SS;
const SH = H * SS;
const fb = new Uint8Array(SW * SH * 3);

type RGB = [number, number, number];

const PAPER: RGB = [246, 241, 229];
const PANEL: RGB = [255, 253, 246];
const INK: RGB = [24, 24, 24];
const SOFT: RGB = [62, 58, 50];
const FAINT: RGB = [107, 98, 82];
const RED: RGB = [166, 25, 46];
const NAVY: RGB = [22, 50, 79];
const GOLD: RGB = [178, 141, 44];
const WHITE: RGB = [255, 255, 255];

function setPx(x: number, y: number, c: RGB): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH) return;
  const i = (y * SW + x) * 3;
  fb[i] = c[0];
  fb[i + 1] = c[1];
  fb[i + 2] = c[2];
}

function blendPx(x: number, y: number, c: RGB, a: number): void {
  if (x < 0 || y < 0 || x >= SW || y >= SH || a <= 0) return;
  if (a >= 1) {
    setPx(x, y, c);
    return;
  }
  const i = (y * SW + x) * 3;
  fb[i] = Math.round(c[0] * a + fb[i] * (1 - a));
  fb[i + 1] = Math.round(c[1] * a + fb[i + 1] * (1 - a));
  fb[i + 2] = Math.round(c[2] * a + fb[i + 2] * (1 - a));
}

/** Filled rectangle in design coordinates. */
function rect(x: number, y: number, w: number, h: number, c: RGB): void {
  const x0 = Math.round(x * SS);
  const y0 = Math.round(y * SS);
  const x1 = Math.round((x + w) * SS);
  const y1 = Math.round((y + h) * SS);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) setPx(xx, yy, c);
  }
}

/** Filled circle in design coordinates. */
function circle(cx: number, cy: number, r: number, c: RGB): void {
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rr = r * SS;
  const x0 = Math.floor(ccx - rr);
  const x1 = Math.ceil(ccx + rr);
  const y0 = Math.floor(ccy - rr);
  const y1 = Math.ceil(ccy + rr);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = xx - ccx;
      const dy = yy - ccy;
      if (dx * dx + dy * dy <= rr * rr) setPx(xx, yy, c);
    }
  }
}

/** Filled ellipse in design coordinates. */
function ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB): void {
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rrx = rx * SS;
  const rry = ry * SS;
  const x0 = Math.floor(ccx - rrx);
  const x1 = Math.ceil(ccx + rrx);
  const y0 = Math.floor(ccy - rry);
  const y1 = Math.ceil(ccy + rry);
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) {
      const dx = (xx - ccx) / rrx;
      const dy = (yy - ccy) / rry;
      if (dx * dx + dy * dy <= 1) setPx(xx, yy, c);
    }
  }
}

/** Filled polygon (even-odd scanline) in design coordinates. */
function poly(pts: [number, number][], c: RGB): void {
  const sp = pts.map(([x, y]) => [x * SS, y * SS] as [number, number]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of sp) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(SH - 1, Math.ceil(maxY));
  for (let yy = y0; yy <= y1; yy++) {
    const xs: number[] = [];
    for (let i = 0; i < sp.length; i++) {
      const [ax, ay] = sp[i];
      const [bx, by] = sp[(i + 1) % sp.length];
      if ((ay <= yy && by > yy) || (by <= yy && ay > yy)) {
        xs.push(ax + ((yy - ay) / (by - ay)) * (bx - ax));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.max(0, Math.round(xs[i]));
      const xb = Math.min(SW - 1, Math.round(xs[i + 1]));
      for (let xx = xa; xx <= xb; xx++) setPx(xx, yy, c);
    }
  }
}

/** Thick line with round caps, in design coordinates. */
function line(x1: number, y1: number, x2: number, y2: number, w: number, c: RGB): void {
  const steps = Math.max(2, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * SS));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    circle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, c);
  }
}

/** Five-pointed star polygon points. */
function starPts(cx: number, cy: number, r: number, rot = -Math.PI / 2): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = rot + (i * Math.PI) / 5;
    pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
  }
  return pts;
}

// ---------------------------------------------------------------------------
// Text: glyph bitmaps from font.mjs, bilinear-sampled and alpha-blended.
// A "size" is the font's em size in design pixels.
// ---------------------------------------------------------------------------

interface Face {
  size: number;
  ascent: number;
  descent: number;
  glyphs: Record<string, [number, number, number, number, number, number]>;
  data: Uint8Array;
}

function face(name: string): Face {
  return (FONTS as Record<string, Face>)[name];
}

function glyphOf(f: Face, ch: string) {
  return f.glyphs[ch] ?? f.glyphs['?'];
}

function textWidth(name: string, text: string, px: number, spacing = 0): number {
  const f = face(name);
  const s = px / f.size;
  let w = 0;
  for (const ch of text) w += glyphOf(f, ch)[0] * s + spacing;
  return text.length > 0 ? w - spacing : 0;
}

function lineHeight(name: string, px: number): number {
  const f = face(name);
  return ((f.ascent + f.descent) * px) / f.size;
}

function blitGlyph(f: Face, g: [number, number, number, number, number, number], dx: number, dy: number, scale: number, c: RGB): void {
  const [, , , gw, gh, off] = g;
  if (gw === 0 || gh === 0 || off < 0) return;
  // Destination box in device pixels.
  const ddx = dx * SS;
  const ddy = dy * SS;
  const ddw = gw * scale * SS;
  const ddh = gh * scale * SS;
  const x0 = Math.floor(ddx);
  const y0 = Math.floor(ddy);
  const x1 = Math.ceil(ddx + ddw);
  const y1 = Math.ceil(ddy + ddh);
  for (let yy = y0; yy < y1; yy++) {
    const sy = ((yy + 0.5 - ddy) / ddh) * gh - 0.5;
    const syi = Math.floor(sy);
    const fy = sy - syi;
    for (let xx = x0; xx < x1; xx++) {
      const sx = ((xx + 0.5 - ddx) / ddw) * gw - 0.5;
      const sxi = Math.floor(sx);
      const fx = sx - sxi;
      let acc = 0;
      for (let oy = 0; oy <= 1; oy++) {
        const syy = Math.min(gh - 1, Math.max(0, syi + oy));
        const wy = oy === 0 ? 1 - fy : fy;
        for (let ox = 0; ox <= 1; ox++) {
          const sxx = Math.min(gw - 1, Math.max(0, sxi + ox));
          const wx = ox === 0 ? 1 - fx : fx;
          acc += f.data[off + syy * gw + sxx] * wx * wy;
        }
      }
      if (acc > 0) blendPx(xx, yy, c, acc / 255);
    }
  }
}

/**
 * Draw one line of text. (x, y) is the baseline start in design coordinates;
 * align shifts the start by the measured width. Returns the pen end x.
 */
function text(name: string, str: string, x: number, y: number, px: number, c: RGB, align: 'left' | 'center' | 'right' = 'left', spacing = 0): number {
  const f = face(name);
  const scale = px / f.size;
  let pen = x;
  if (align !== 'left') {
    const w = textWidth(name, str, px, spacing);
    pen = align === 'center' ? x - w / 2 : x - w;
  }
  for (const ch of str) {
    const g = glyphOf(f, ch);
    blitGlyph(f, g, pen + g[1] * scale, y + g[2] * scale, scale, c);
    pen += g[0] * scale + spacing;
  }
  return pen;
}

/** Greedy word wrap to a maximum width; returns the lines. */
function wrap(name: string, str: string, px: number, maxWidth: number): string[] {
  const words = str.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const trial = cur === '' ? word : cur + ' ' + word;
    if (cur !== '' && textWidth(name, trial, px) > maxWidth) {
      lines.push(cur);
      cur = word;
    } else {
      cur = trial;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/**
 * Wrap text at a size that fits maxLines lines of maxWidth, shrinking from
 * startPx down if needed. Returns the size used and the lines.
 */
function fitLines(name: string, str: string, maxWidth: number, startPx: number, maxLines: number, minPx = 18): { px: number; lines: string[] } {
  let px = startPx;
  let lines = wrap(name, str, px, maxWidth);
  while (lines.length > maxLines && px > minPx) {
    px -= 1;
    lines = wrap(name, str, px, maxWidth);
  }
  return { px, lines };
}

/** Draw wrapped lines from a top y (first baseline = y + ascent share). */
function block(name: string, lines: string[], x: number, yTop: number, px: number, c: RGB, leading = 1.28): void {
  const lh = lineHeight(name, px) * leading;
  const asc = (face(name).ascent * px) / face(name).size;
  lines.forEach((ln, i) => {
    text(name, ln, x, yTop + asc + i * lh, px, c);
  });
}

// ---------------------------------------------------------------------------
// PNG encoding (deterministic: fixed filter, fixed deflate level).
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crcData = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) crcData[i] = type.charCodeAt(i);
  crcData.set(data, 4);
  dv.setUint32(8 + data.length, crc32(crcData));
  return out;
}

function encodePng(): Uint8Array {
  // Box-downsample the 2x buffer to 1024x1024 RGB.
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let oy = 0; oy < SS; oy++) {
        for (let ox = 0; ox < SS; ox++) {
          const i = ((y * SS + oy) * SW + (x * SS + ox)) * 3;
          r += fb[i];
          g += fb[i + 1];
          b += fb[i + 2];
        }
      }
      const o = (y * W + x) * 3;
      rgb[o] = Math.round(r / (SS * SS));
      rgb[o + 1] = Math.round(g / (SS * SS));
      rgb[o + 2] = Math.round(b / (SS * SS));
    }
  }
  const raw = new Uint8Array(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0;
    raw.set(rgb.subarray(y * W * 3, (y + 1) * W * 3), y * (1 + W * 3) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, W);
  dv.setUint32(4, H);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour RGB
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const idat = deflateSync(raw, { level: 9 });
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(idat)), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Drawn pictures. Everything is flat shapes drawn by this program: no photos,
// no copied artwork.
// ---------------------------------------------------------------------------

/** United States flag in a w x h box. */
function flagUS(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, WHITE);
  const stripe = h / 13;
  for (let i = 0; i < 13; i += 2) rect(x, y + i * stripe, w, stripe + 0.6, [178, 34, 52]);
  rect(x, y, w * 0.42, stripe * 7, [38, 48, 110]);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      circle(x + 5 + c * (w * 0.42 - 8) / 3, y + 4.5 + r * (stripe * 7 - 8) / 2, 1.5, WHITE);
    }
  }
}

/** China flag in a w x h box. */
function flagChina(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [222, 41, 57]);
  poly(starPts(x + w * 0.22, y + h * 0.3, w * 0.13), [255, 222, 0]);
  poly(starPts(x + w * 0.42, y + h * 0.14, w * 0.05), [255, 222, 0]);
  poly(starPts(x + w * 0.47, y + h * 0.3, w * 0.05), [255, 222, 0]);
  poly(starPts(x + w * 0.42, y + h * 0.46, w * 0.05), [255, 222, 0]);
}

/** Russia flag in a w x h box. */
function flagRussia(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h / 3 + 0.6, WHITE);
  rect(x, y + h / 3, w, h / 3 + 0.6, [28, 79, 156]);
  rect(x, y + (2 * h) / 3, w, h / 3 + 0.6, [213, 43, 30]);
}

/** Lead picture: Shenzhen skyline, three flags over a plaza. */
function drawLeadArt(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [207, 221, 232]);
  circle(x + w - 42, y + 24, 13, [240, 199, 94]);
  // Far towers.
  const far: [number, number][] = [[6, 34], [38, 48], [76, 28], [150, 42], [196, 30], [238, 52], [276, 36]];
  for (const [tx, th] of far) rect(x + tx, y + h - 16 - th, 24, th, [168, 191, 208]);
  // Near skyline in navy, with lit windows.
  const near: [number, number, number][] = [[0, 30, 62], [34, 20, 44], [58, 38, 78], [102, 24, 52], [188, 30, 68], [224, 22, 46], [252, 36, 72], [292, 26, 40]];
  for (const [tx, tw, th] of near) {
    rect(x + tx, y + h - 14 - th, tw, th, NAVY);
    for (let wy = 0; wy < Math.floor(th / 12); wy++) {
      for (let wx = 0; wx < Math.floor(tw / 9); wx++) {
        if ((wx * 7 + wy * 3 + tx) % 5 < 2) rect(x + tx + 3 + wx * 9, y + h - 14 - th + 4 + wy * 12, 3.4, 4.6, [240, 199, 94]);
      }
    }
  }
  // Plaza band and flag poles.
  rect(x, y + h - 14, w, 14, [122, 106, 83]);
  const flags: ((fx: number, fy: number, fw: number, fh: number) => void)[] = [flagUS, flagChina, flagRussia];
  [64, 150, 236].forEach((px, i) => {
    rect(x + px, y + 16, 2.6, h - 30, [68, 64, 58]);
    circle(x + px + 1.3, y + 14, 2.6, GOLD);
    flags[i](x + px + 3, y + 16, 47, 30);
  });
}

/** Card picture: a columned courthouse (the World Court story). */
function drawCourtArt(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [239, 230, 207]);
  const cx = x + w / 2;
  poly([[cx - 46, y + 40], [cx + 46, y + 40], [cx, y + 14]], NAVY);
  circle(cx, y + 33, 4.5, GOLD);
  rect(cx - 46, y + 42, 92, 6, NAVY);
  for (let i = 0; i < 4; i++) rect(cx - 39 + i * 24, y + 54, 9, 44, NAVY);
  rect(cx - 48, y + 100, 96, 6, NAVY);
  rect(cx - 52, y + 108, 104, 5, [140, 132, 112]);
  rect(cx - 56, y + 115, 112, 5, [140, 132, 112]);
}

/** Card picture: a spiking then plunging market line (the IPO / sell-off story). */
function drawMarketArt(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [238, 243, 238]);
  for (let gx = 12; gx < w; gx += 16) {
    for (let gy = 12; gy < h; gy += 16) circle(x + gx, y + gy, 1.1, [196, 208, 196]);
  }
  const up: [number, number][] = [[10, 92], [32, 78], [48, 84], [66, 40]];
  const down: [number, number][] = [[66, 40], [84, 74], [106, 102]];
  for (let i = 0; i + 1 < up.length; i++) line(x + up[i][0], y + up[i][1], x + up[i + 1][0], y + up[i + 1][1], 4.4, [30, 138, 76]);
  for (let i = 0; i + 1 < down.length; i++) line(x + down[i][0], y + down[i][1], x + down[i + 1][0], y + down[i + 1][1], 4.4, RED);
  poly([[x + 106, y + 102], [x + 94, y + 98], [x + 102, y + 88]], RED);
  circle(x + 66, y + 40, 5.5, GOLD);
}

/** Card picture: the Capitol dome under a dashed arc of fire (the Iran war vote). */
function drawCapitolArt(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [240, 231, 218]);
  const cx = x + w / 2;
  // Dashed red arc overhead.
  for (let i = 0; i < 7; i++) {
    const a1 = Math.PI * (0.08 + i * 0.13);
    const a2 = a1 + Math.PI * 0.07;
    line(cx + Math.cos(a1) * 52, y + 66 - Math.sin(a1) * 52, cx + Math.cos(a2) * 52, y + 66 - Math.sin(a2) * 52, 3.4, RED);
  }
  // Dome.
  const dome: [number, number][] = [];
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    dome.push([cx + Math.cos(a) * 34, y + 78 - Math.sin(a) * 32]);
  }
  dome.push([cx + 34, y + 78]);
  dome.push([cx - 34, y + 78]);
  poly(dome, NAVY);
  rect(cx - 2.4, y + 34, 4.8, 12, NAVY);
  circle(cx, y + 32, 3.4, NAVY);
  rect(cx - 38, y + 78, 76, 7, NAVY);
  rect(cx - 44, y + 85, 88, 26, NAVY);
  for (let i = 0; i < 5; i++) rect(cx - 36 + i * 16, y + 89, 5, 18, [240, 231, 218]);
  rect(cx - 48, y + 111, 96, 5, [140, 132, 112]);
}

/** Card picture: Voyager 1 and the Earth it phones home to (the space story). */
function drawVoyagerArt(x: number, y: number, w: number, h: number): void {
  rect(x, y, w, h, [16, 38, 61]);
  for (let i = 0; i < 30; i++) {
    const sx = x + ((i * 37 + 11) % 108) + 4;
    const sy = y + ((i * 53 + 7) % 118) + 5;
    circle(sx, sy, i % 4 === 0 ? 1.7 : 1.1, WHITE);
  }
  // Earth, bottom left.
  circle(x + 24, y + 104, 11, [61, 123, 214]);
  circle(x + 20, y + 100, 3.6, [74, 176, 110]);
  circle(x + 28, y + 108, 2.8, [74, 176, 110]);
  // Signal arcs from the probe towards Earth.
  for (const r of [17, 25, 33]) {
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const a = Math.PI * (0.62 + (i / 10) * 0.42);
      pts.push([x + 72 + Math.cos(a) * r, y + 48 + Math.sin(a) * r]);
    }
    for (let i = 0; i + 1 < pts.length; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 2.4, [240, 199, 94]);
  }
  // The probe: dish, bus, boom and golden record.
  ellipse(x + 74, y + 46, 21, 8.5, [217, 211, 195]);
  ellipse(x + 74, y + 45, 12, 4.6, [168, 160, 144]);
  line(x + 74, y + 46, x + 74, y + 30, 2.6, [217, 211, 195]);
  rect(x + 66, y + 54, 16, 12, [185, 192, 199]);
  line(x + 80, y + 62, x + 100, y + 82, 3, [138, 143, 150]);
  rect(x + 97, y + 80, 7, 10, [138, 143, 150]);
  circle(x + 62, y + 62, 5.5, GOLD);
}

// ---------------------------------------------------------------------------
// The page. All stories happened, or were first reported, on Thursday
// 19 November 2026; wording follows the day's reporting (WSJ, AP, BBC,
// UN News, Investopedia market wrap).
// ---------------------------------------------------------------------------

const MX = 44; // content left edge
const MW = 936; // content width

function panel(x: number, y: number, w: number, h: number, accent: RGB): void {
  rect(x, y, w, h, PANEL);
  rect(x, y, w, 5, accent);
  line(x, y + h, x + w, y + h, 1.4, [196, 188, 168]);
  line(x + w, y, x + w, y + h, 1.4, [196, 188, 168]);
  line(x, y, x, y + h, 1.4, [196, 188, 168]);
}

function drawMasthead(): void {
  text('sansBold', 'ONE DAY · ONE PICTURE · THE WHOLE WORLD', 512, 52, 22, FAINT, 'center', 3);
  text('serifBold', 'THE WORLD TODAY', 512, 124, 84, INK, 'center');
  line(MX, 140, MX + MW, 140, 2.4, INK);
  line(MX, 146, MX + MW, 146, 1, INK);
  rect(MX, 156, MW, 48, RED);
  text('sansBold', 'THURSDAY · 19 NOVEMBER 2026', 512, 156 + 24 + 14, 37, WHITE, 'center', 1);
}

function drawLead(): void {
  const y = 218;
  panel(MX, y, MW, 324, RED);
  text('sansBold', 'LEAD STORY — SHENZHEN, CHINA', MX + 24, y + 42, 23, RED, 'left', 1);
  const head = fitLines('serifBold', 'Trump, Xi and Putin hold first-ever three-way summit', MW - 48, 53, 2);
  block('serifBold', head.lines, MX + 24, y + 56, head.px, INK, 1.12);
  const headBottom = y + 56 + head.lines.length * lineHeight('serifBold', head.px) * 1.12;
  line(MX + 24, headBottom + 8, MX + MW - 24, headBottom + 8, 1.2, [196, 188, 168]);
  const artY = headBottom + 22;
  const artH = y + 324 - artY - 18;
  drawLeadArt(MX + 24, artY, 300, artH);
  const cap = fitLines('sans', 'They declared a nuclear war “cannot be won and must never be fought”, and pledged talks on cutting nuclear risks.', 540, 27, 4);
  block('sans', cap.lines, MX + 348, artY + 2, cap.px, SOFT, 1.24);
}

interface Story {
  kicker: string;
  headline: string;
  caption: string;
  accent: RGB;
  art: (x: number, y: number, w: number, h: number) => void;
}

const STORIES: Story[] = [
  {
    kicker: 'THE HAGUE · WORLD COURT',
    headline: 'Myanmar guilty of Rohingya genocide',
    caption: 'The World Court’s first genocide ruling against a state',
    accent: [178, 141, 44],
    art: drawCourtArt,
  },
  {
    kicker: 'NEW YORK · MARKETS',
    headline: 'Anthropic’s record IPO can’t lift Wall St',
    caption: 'Dow plunges 1,100 points as the AI sell-off deepens',
    accent: [30, 138, 76],
    art: drawMarketArt,
  },
  {
    kicker: 'WASHINGTON · SENATE',
    headline: 'Senate won’t halt Iran war, 51–48',
    caption: 'War-powers bill fails as Gulf attacks widen',
    accent: RED,
    art: drawCapitolArt,
  },
  {
    kicker: 'DEEP SPACE · NASA',
    headline: 'Voyager 1 now one light-day from Earth',
    caption: 'Its signal takes a full day to reach home',
    accent: NAVY,
    art: drawVoyagerArt,
  },
];

function drawCard(s: Story, x: number, y: number, w: number, h: number): void {
  panel(x, y, w, h, s.accent);
  text('sansBold', s.kicker, x + 16, y + 31, 20, s.accent, 'left', 0.6);
  s.art(x + 16, y + 44, 116, h - 58);
  const tx = x + 148;
  const tw = w - 148 - 14;
  const head = fitLines('serifBold', s.headline, tw, 29, 2);
  block('serifBold', head.lines, tx, y + 40, head.px, INK, 1.06);
  const capY = y + 40 + head.lines.length * lineHeight('serifBold', head.px) * 1.06 + 6;
  const cap = fitLines('sans', s.caption, tw, 23, 2);
  block('sans', cap.lines, tx, capY, cap.px, SOFT, 1.14);
}

function drawGrid(): void {
  const y = 556;
  const cw = (MW - 12) / 2;
  const ch = 174;
  drawCard(STORIES[0], MX, y, cw, ch);
  drawCard(STORIES[1], MX + cw + 12, y, cw, ch);
  drawCard(STORIES[2], MX, y + ch + 12, cw, ch);
  drawCard(STORIES[3], MX + cw + 12, y + ch + 12, cw, ch);
}

const BRIEFS: [string, string][] = [
  ['GAZA', 'Aid groups score peace plan just 4 of 26'],
  ['FUEL', 'US petrol in steepest 3-week dive since 2008'],
  ['FIJI', 'National disaster declared over El Niño drought'],
];

function drawBriefs(): void {
  const y = 924;
  rect(MX, y, MW, 78, INK);
  const cw = MW / 3;
  BRIEFS.forEach(([label, body], i) => {
    const x = MX + i * cw + 16;
    text('sansBold', label, x, y + 26, 19, [240, 199, 94], 'left', 1);
    const bodyFit = fitLines('sans', body, cw - 32, 20, 2);
    block('sans', bodyFit.lines, x, y + 33, bodyFit.px, WHITE, 1.12);
    if (i > 0) line(MX + i * cw, y + 10, MX + i * cw, y + 68, 1.2, [90, 86, 76]);
  });
}

function drawFrame(): void {
  rect(12, 12, W - 24, 3, INK);
  rect(12, H - 15, W - 24, 3, INK);
  rect(12, 12, 3, H - 24, INK);
  rect(W - 15, 12, 3, H - 24, INK);
  rect(20, 20, W - 40, 1.2, FAINT);
  rect(20, H - 21, W - 40, 1.2, FAINT);
  rect(20, 20, 1.2, H - 40, FAINT);
  rect(W - 21, 20, 1.2, H - 40, FAINT);
}

// ---------------------------------------------------------------------------

rect(0, 0, W, H, PAPER);
drawMasthead();
drawLead();
drawGrid();
drawBriefs();
drawFrame();

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(outDir, { recursive: true });
const png = encodePng();
writeFileSync(join(outDir, 'entry.png'), png);
console.log(`wrote ${join(outDir, 'entry.png')} (${png.length} bytes)`);
