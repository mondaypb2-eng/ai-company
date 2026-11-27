// Pixel Office - 8-bit animated office scene for AI Company.
// window.PixelOffice.mount(containerEl, agents) -> api {work, rest, tool, think, handoff, qa, done, board, say, reset}
(function () {
  const W = 320, H = 180, DESK_Y = 118, WALK_Y = 152;

  // ---- tiny 3x5 bitmap font -------------------------------------------------
  const G = {
    0:"111101101101111",1:"010110010010111",2:"111001111100111",3:"111001111001111",4:"101101111001001",
    5:"111100111001111",6:"111100111101111",7:"111001010010010",8:"111101111101111",9:"111101111001111",
    A:"010101111101101",B:"110101110101110",C:"011100100100011",D:"110101101101110",E:"111100110100111",
    F:"111100110100100",G:"011100101101011",H:"101101111101101",I:"111010010010111",J:"001001001101010",
    K:"101101110101101",L:"100100100100111",M:"101111111101101",N:"110101101101101",O:"010101101101010",
    P:"110101110100100",Q:"010101101110011",R:"110101110101101",S:"011100010001110",T:"111010010010010",
    U:"101101101101111",V:"101101101101010",W:"101101111111101",X:"101101010101101",Y:"101101010010010",
    Z:"111001010100111","/":"001001010100100",":":"000010000010000","-":"000000111000000","%":"101001010100101",
    ".":"000000000000010","!":"010010010000010"," ":"000000000000000","$":"011110010011110","+":"000010111010000"
  };
  function text(ctx, s, x, y, col, scale = 1) {
    ctx.fillStyle = col;
    for (const ch of String(s).toUpperCase()) {
      const g = G[ch] || G[" "];
      for (let i = 0; i < 15; i++) if (g[i] === "1") ctx.fillRect(x + (i % 3) * scale, y + Math.floor(i / 3) * scale, scale, scale);
      x += 4 * scale;
    }
  }
  const textW = (s, scale = 1) => String(s).length * 4 * scale - scale;

  // ---- looks ----------------------------------------------------------------
  const LOOK = {
    ceo: { skin: "#f2c29b", hair: "#6b6b78", shirt: "#2b2d42", shade: "#1c1d2c", pants: "#1c1d2c", hairStyle: "slick", acc: "tie", plate: "CEO" },
    pm:  { skin: "#e8b48a", hair: "#6b3a1f", shirt: "#8a4fd8", shade: "#6a37b0", pants: "#3a3550", hairStyle: "long", acc: "clip", plate: "PM" },
    des: { skin: "#f6d0ae", hair: "#1b1b1b", shirt: "#f29e1f", shade: "#cf7f0c", pants: "#3c4a6b", hairStyle: "bob", acc: "beret", plate: "ARCH" },
    eng: { skin: "#c98a5a", hair: "#2a1d15", shirt: "#1fa35b", shade: "#157e45", pants: "#2f3a4a", hairStyle: "messy", acc: "phones", plate: "DEV" },
    qa:  { skin: "#f0c4a0", hair: "#a0522d", shirt: "#1c8fd6", shade: "#1570ab", pants: "#2f3a4a", hairStyle: "short", acc: "glasses", plate: "QA" },
  };
  const STAGE = { "รับบรีฟ": "BRIEF", "วางแผน": "PLAN", "พัฒนา": "BUILD", "ตรวจงาน": "TEST", "ส่งมอบแล้ว": "DONE" };
  const STAGE_I = { BRIEF: 0, PLAN: 1, BUILD: 2, TEST: 3, DONE: 4 };

  function mount(root, agents) {
    root.innerHTML = "";
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H; cv.setAttribute("aria-label", "ออฟฟิศพิกเซลของทีม AI");
    root.appendChild(cv);
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    const dark = matchMedia("(prefers-color-scheme: dark)");
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

    // seeded random for stable scenery
    let seed = 7; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const buildings = []; for (let x = 122; x < 200;) { const w = 6 + Math.floor(rnd() * 7), h = 12 + Math.floor(rnd() * 26); buildings.push({ x, w, h, lit: [] }); x += w + 1; }
    buildings.forEach(b => { for (let yy = 0; yy < b.h - 3; yy += 3) for (let xx = 1; xx < b.w - 1; xx += 2) if (rnd() > .55) b.lit.push([xx, yy, rnd()]); });
    const stars = Array.from({ length: 18 }, () => [122 + Math.floor(rnd() * 76), 12 + Math.floor(rnd() * 22), rnd() * 6]);
    const clouds = [{ x: 130, y: 16, w: 14 }, { x: 175, y: 24, w: 10 }];

    const N = agents.length, gap = W / N;
    const chars = {};
    agents.forEach((a, i) => {
      const cx = Math.round(gap * i + gap / 2);
      chars[a.id] = { id: a.id, look: LOOK[a.id], cx, x: cx + 4, y: DESK_Y, dir: 1, mode: "sit", act: "idle", actT: 0,
        walkT: 0, path: [], carrying: false, blinkAt: 1 + Math.random() * 3, blink: 0, sweat: 0, shake: 0, jump: 0,
        papers: 0, bubble: null, mood: 0 };
    });
    let board = { stage: "BRIEF", round: 0, max: 0, score: null };
    let confetti = [], flyers = [];
    const cat = { x: 60, dir: 1, state: "walk", t: 0, next: 4 };

    // ---- bubbles (HTML so Thai text renders crisply) ----
    agents.forEach(a => {
      const b = document.createElement("div");
      b.className = "pbub off"; b.innerHTML = `<b></b><p></p>`;
      b.querySelector("b").textContent = a.name;
      root.appendChild(b); chars[a.id].bubble = b;
    });

    // ---- drawing helpers ----
    const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
    function line(x0, y0, x1, y1, c) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let e = dx + dy;
      for (;;) { R(x0, y0, 1, 1, c); if (x0 === x1 && y0 === y1) break; const e2 = 2 * e; if (e2 >= dy) { e += dy; x0 += sx; } if (e2 <= dx) { e += dx; y0 += sy; } }
    }
    function circle(cx, cy, r, c) { for (let y = -r; y <= r; y++) { const w = Math.round(Math.sqrt(r * r - y * y)); R(cx - w, cy + y, w * 2 + 1, 1, c); } }

    function drawRoom(t, night) {
      // wall with vertical stripes
      R(0, 0, W, 96, night ? "#1e2a5a" : "#3b5dc9");
      for (let x = 0; x < W; x += 8) R(x, 0, 4, 96, night ? "#1b2652" : "#3757bf");
      R(0, 92, W, 4, night ? "#141b3d" : "#26357a");
      // floor checker
      for (let y = 96; y < H; y += 12) for (let x = 0; x < W; x += 16) {
        const odd = ((x / 16) + ((y - 96) / 12)) % 2;
        R(x, y, 16, 12, night ? (odd ? "#4e3a2a" : "#5a4330") : (odd ? "#bf8444" : "#cf9552"));
      }
      R(0, 96, W, 1, "rgba(0,0,0,.25)");

      // window
      R(118, 8, 84, 50, "#dbe7ff");
      const sky = night ? ["#0b1030", "#121a45", "#1b2560"] : ["#7fb2ff", "#9cc4ff", "#bcd8ff"];
      for (let i = 0; i < 3; i++) R(122, 12 + i * 14, 76, 14 + (i === 2 ? 2 : 0), sky[i]);
      if (night) {
        stars.forEach(([sx, sy, ph]) => { if (Math.sin(t * 2 + ph) > -.3) R(sx, sy, 1, 1, "#fff"); });
        circle(186, 20, 4, "#fff6c9"); circle(188, 19, 3, sky[0]);
      } else {
        circle(188, 20, 5, "#ffd25e");
        clouds.forEach(c => { const x = 122 + ((c.x - 122 + t * 3) % 96) - 10; R(x, c.y, c.w, 3, "#fff"); R(x + 2, c.y - 2, c.w - 5, 2, "#fff"); });
      }
      buildings.forEach(b => {
        R(b.x, 56 - b.h, b.w, b.h, night ? "#2a3570" : "#6f8fd6");
        b.lit.forEach(([lx, ly, ph]) => { const on = night ? Math.sin(t * .4 + ph * 20) > -.6 : ph > .7; if (on) R(b.x + lx, 56 - b.h + 2 + ly, 1, 1, night ? "#ffe27a" : "#cfe0ff"); });
      });
      R(118, 8, 84, 4, "#dbe7ff"); R(118, 54, 84, 4, "#dbe7ff"); R(158, 8, 3, 50, "#dbe7ff"); R(116, 57, 88, 3, "#b9c6e6");

      // kanban whiteboard
      R(12, 8, 92, 52, "#c9cfdc"); R(14, 10, 88, 48, "#ffffff");
      text(ctx, "SPRINT", 17, 13, "#2f5fd0");
      text(ctx, board.stage, 100 - textW(board.stage) - 1, 13, "#ff5a4e");
      const cols = ["TODO", "DOING", "DONE"]; const si = STAGE_I[board.stage] ?? 0;
      cols.forEach((c, i) => { const x = 17 + i * 28; text(ctx, c, x, 21, "#8a8fa3"); R(x, 27, 26, 1, "#e3e6ee"); });
      const total = 6, done = Math.min(total, si === 4 ? 6 : si + (board.round || 0)), doing = si === 4 ? 0 : 1;
      const notes = ["#ffd25e", "#ff9fb2", "#9be7a7", "#9fd8ff", "#ffb86b", "#c9a7ff"];
      let ti = 0, di = 0, ni = 0;
      for (let k = 0; k < total; k++) {
        const col = k < done ? 2 : k < done + doing ? 1 : 0;
        const slot = col === 2 ? ni++ : col === 1 ? di++ : ti++;
        const x = 18 + col * 28 + (slot % 3) * 8, y = 30 + Math.floor(slot / 3) * 6;
        R(x, y, 6, 4, notes[k]); R(x, y, 6, 1, "rgba(0,0,0,.08)");
      }
      text(ctx, board.round ? `R${board.round}/${board.max}` : "R-", 17, 47, "#1d1b26");
      text(ctx, board.score == null ? "QA -" : `QA ${board.score}`, 48, 47, "#1d1b26");
      R(76, 48, 22, 3, "#e9edf5"); if (board.score) R(76, 48, Math.round(22 * Math.min(100, board.score) / 100), 3, board.score >= 85 ? "#1fa35b" : "#ff5a4e");

      // clock (real time)
      circle(230, 26, 11, "#c9cfdc"); circle(230, 26, 9, "#ffffff");
      for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; R(230 + Math.round(Math.sin(a) * 8), 26 - Math.round(Math.cos(a) * 8), 1, 1, "#9aa0b4"); }
      const d = new Date(), hA = ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * Math.PI * 2, mA = d.getMinutes() / 60 * Math.PI * 2, sA = d.getSeconds() / 60 * Math.PI * 2;
      line(230, 26, 230 + Math.sin(hA) * 4, 26 - Math.cos(hA) * 4, "#1d1b26");
      line(230, 26, 230 + Math.sin(mA) * 7, 26 - Math.cos(mA) * 7, "#1d1b26");
      line(230, 26, 230 + Math.sin(sA) * 7, 26 - Math.cos(sA) * 7, "#ff5a4e");

      // poster
      R(262, 14, 40, 30, "#ffd25e"); R(264, 16, 36, 26, "#ff5a4e");
      text(ctx, "SHIP", 274, 20, "#fff"); text(ctx, "IT!", 276, 28, "#fff"); R(270, 36, 24, 2, "#fff");

      // water cooler in gap
      const wx = Math.round(gap - 6);
      R(wx, 76, 12, 20, "#d7dde8"); R(wx + 1, 78, 10, 6, "#eef2f8"); R(wx + 2, 64, 8, 12, "#8fd0ff"); R(wx + 3, 62, 6, 2, "#6bb6ea");
      const bub = (t * 0.8) % 1; if (bub < .9) R(wx + 4 + (Math.floor(t * 3) % 2), 74 - Math.floor(bub * 10), 1, 1, "#e6f6ff");
      R(wx + 4, 86, 4, 2, "#3b6ea8");

      // plant in gap 4 (sways)
      const px = Math.round(gap * 4 - 6), sway = reduce ? 0 : Math.round(Math.sin(t * 1.4));
      R(px, 86, 12, 10, "#c46a3a"); R(px, 86, 12, 2, "#a85a30");
      const leaf = "#2e9e5b", leaf2 = "#237a46";
      R(px + 5 + sway, 66, 2, 20, leaf2);
      R(px + 1 + sway, 70, 4, 3, leaf); R(px + 7 + sway, 68, 4, 3, leaf); R(px + 2 + sway, 76, 4, 3, leaf2);
      R(px + 7 + sway, 74, 4, 3, leaf); R(px + 4 + sway, 63, 4, 3, leaf);
    }

    function drawDesk(c, t) {
      const x = c.cx;
      // chair back (behind character)
      R(x - 2, 101, 13, 12, "#3a3a48"); R(x - 2, 101, 13, 2, "#4a4a5c");
    }
    function drawDeskFront(c, t, night) {
      const x = c.cx;
      // monitor on the left of desk, facing viewer
      R(x - 21, 94, 15, 12, "#2b2d42");
      const scrX = x - 20, scrY = 95, sw = 13, sh = 9;
      const act = c.act === "cheer" ? (c.prevAct || "idle") : c.act;
      if (c.mode === "sit" && c.working && (act === "type" || act === "run" || act === "read")) {
        if (act === "run") {
          R(scrX, scrY, sw, sh, "#0c1410");
          for (let i = 0; i < 4; i++) { const w = 3 + Math.floor((Math.sin(t * 3 + i * 7 + c.cx) + 1) * 4); R(scrX + 1, scrY + 1 + i * 2, w, 1, "#39ff88"); }
          if (Math.floor(t * 4) % 2) R(scrX + 1 + 9, scrY + 7, 2, 1, "#39ff88");
        } else {
          R(scrX, scrY, sw, sh, "#1b2236");
          const off = Math.floor(t * (act === "read" ? 10 : 5));
          const cols = ["#ff7b9c", "#7fd0ff", "#ffd25e", "#9be7a7", "#c9a7ff"];
          for (let i = 0; i < 4; i++) {
            const k = off + i, ind = (k * 7) % 3, w = 3 + (k * 13) % 7;
            R(scrX + 1 + ind, scrY + 1 + i * 2, Math.min(w, sw - 2 - ind), 1, cols[k % cols.length]);
          }
          if (act === "read") R(scrX, scrY + 3, sw, 2, "rgba(255,255,255,.12)");
        }
      } else if (act === "think" && c.working && c.mode === "sit") {
        R(scrX, scrY, sw, sh, "#1b2236"); if (Math.floor(t * 2) % 2) R(scrX + 2, scrY + 2, 1, 3, "#fff");
      } else {
        R(scrX, scrY, sw, sh, night ? "#121829" : "#26304a");
        const sx = scrX + 1 + Math.floor((Math.sin(t * .7 + c.cx) + 1) * 5), sy = scrY + 1 + Math.floor((Math.cos(t * .5 + c.cx) + 1) * 3);
        R(sx, sy, 1, 1, "#4b5a85");
      }
      R(x - 16, 106, 5, 2, "#2b2d42"); R(x - 18, 108, 9, 2, "#2b2d42");
      // keyboard
      R(x, 108, 10, 2, "#9aa0b4"); R(x, 108, 10, 1, "#c4c9d6");
      // papers received
      for (let k = 0; k < Math.min(3, c.papers); k++) { R(x + 13, 107 - k * 1, 7, 2, k % 2 ? "#f2f2f2" : "#ffffff"); R(x + 13, 108 - k, 7, 1, "#d6d6d6"); }
      // coffee on CEO desk
      if (c.id === "ceo") {
        R(x + 13, 104, 4, 5, "#ffffff"); R(x + 17, 105, 1, 2, "#ffffff"); R(x + 14, 104, 2, 1, "#6b3a1f");
        if (!reduce) for (let i = 0; i < 3; i++) { const p = (t * .6 + i / 3) % 1; R(x + 14 + Math.round(Math.sin((p + i) * 6)), 103 - Math.floor(p * 8), 1, 1, `rgba(255,255,255,${.7 * (1 - p)})`); }
      }
      // desk body
      R(x - 24, 110, 48, 3, "#e8d2a8"); R(x - 24, 113, 48, 1, "#c9a978");
      R(x - 22, 114, 44, 18, "#a8794a"); R(x - 22, 129, 44, 3, "#8e6538"); R(x - 22, 114, 2, 18, "#b98a58");
      R(x - 25, 132, 50, 2, "rgba(0,0,0,.18)");
      // nameplate
      const p = c.look.plate, pw = textW(p, 1) + 6;
      R(x - pw / 2, 118, pw, 9, "#f5ecd7"); R(x - pw / 2, 126, pw, 1, "#d8c9a6");
      text(ctx, p, Math.round(x - textW(p) / 2), 120, "#1d1b26");
      // working light
      if (c.working && c.mode === "sit") { if (Math.floor(t * 3) % 2) R(x + 17, 120, 2, 2, "#ff5a4e"); else R(x + 17, 120, 2, 2, "#ff9a90"); }
    }

    function drawChar(c, t) {
      const L = c.look, d = c.dir;
      const P = (dx, dy, w, h, col) => R(d > 0 ? c.x + dx : c.x - dx - w + 1, c.y + dy, w, h, col);
      const walking = c.mode === "walk";
      const wf = Math.floor(c.walkT * 8) % 4;
      let b = 0;
      if (walking) b = wf % 2 ? -1 : 0;
      else if (!reduce) b = Math.sin(t * 2.2 + c.cx) > .3 ? -1 : 0;          // breathing
      if (c.jump > 0) b -= Math.round(Math.abs(Math.sin(c.jump * 9)) * 6);
      const hb = c.act === "type" && Math.floor(t * 6 + c.cx) % 4 === 0 ? 1 : 0;   // head nod while typing
      const sh = c.shake > 0 ? (Math.floor(c.shake * 20) % 2 ? 1 : -1) : 0;
      const liftL = walking && wf === 1 ? 1 : 0, liftR = walking && wf === 3 ? 1 : 0;

      // shadow
      if (walking || c.jump > 0) R(c.x - 5, c.y, 10, 1, "rgba(0,0,0,.2)");
      // legs + shoes
      P(-3, -6 - liftL, 2, 5, L.pants); P(1, -6 - liftR, 2, 5, L.pants);
      P(-4, -1 - liftL, 3, 1, "#222"); P(1, -1 - liftR, 3, 1, "#222");
      // torso
      P(-5, -14 + b, 10, 8, L.shirt); P(-5, -14 + b, 2, 8, L.shade); P(-5, -7 + b, 10, 1, L.shade);
      if (L.acc === "tie") { P(-1, -14 + b, 3, 1, "#ffffff"); P(0, -13 + b, 1, 5, "#d62839"); }
      if (L.acc === "phones") P(-1, -14 + b, 2, 2, "#ffffff");
      // head
      const hx = sh, hy = b + hb;
      P(-4 + hx, -22 + hy, 8, 8, L.skin);
      // hair
      const H = (dx, dy, w, h) => P(dx + hx, dy + hy, w, h, L.hair);
      switch (L.hairStyle) {
        case "slick": H(-4, -23, 8, 2); H(-4, -21, 1, 2); H(-1, -21, 5, 1); break;
        case "long": H(-5, -23, 10, 3); H(-5, -20, 2, 8); H(3, -20, 2, 8); break;
        case "bob": H(-5, -23, 10, 3); H(-5, -20, 2, 4); H(3, -20, 2, 4); break;
        case "messy": H(-5, -23, 10, 2); H(-4, -24, 2, 1); H(-1, -25, 2, 2); H(3, -24, 1, 1); H(-5, -21, 1, 2); H(4, -21, 1, 2); break;
        default: H(-4, -23, 8, 2); H(-4, -21, 1, 1); H(3, -21, 1, 1);
      }
      // face
      const look = walking ? 1 : 0;
      const eyeY = -19 + hy + (c.mood < 0 ? 1 : 0);
      if (L.acc === "glasses") {
        P(-4 + hx, eyeY, 8, 1, "#222"); P(-3 + hx + look, eyeY, 2, 2, "#222"); P(1 + hx + look, eyeY, 2, 2, "#222");
        if (c.blink <= 0) { P(-2 + hx + look, eyeY + 1, 1, 1, "#9fd8ff"); P(2 + hx + look, eyeY + 1, 1, 1, "#9fd8ff"); }
      } else if (c.blink > 0) {
        P(-2 + hx + look, eyeY + 1, 2, 1, "#1b1b1b"); P(1 + hx + look, eyeY + 1, 2, 1, "#1b1b1b");
      } else {
        P(-2 + hx + look, eyeY, 1, 2, "#1b1b1b"); P(1 + hx + look, eyeY, 1, 2, "#1b1b1b");
        P(-2 + hx + look, eyeY, 1, 1, "#ffffff");
      }
      P(-4 + hx, -17 + hy, 1, 1, "#ff9a9a"); P(3 + hx, -17 + hy, 1, 1, "#ff9a9a");
      if (c.mood > 0) { P(-2 + hx, -16 + hy, 1, 1, "#7a2b25"); P(1 + hx, -16 + hy, 1, 1, "#7a2b25"); P(-1 + hx, -15 + hy, 2, 1, "#7a2b25"); }
      else if (c.mood < 0) { P(-1 + hx, -16 + hy, 2, 1, "#7a2b25"); P(-2 + hx, -15 + hy, 1, 1, "#7a2b25"); P(1 + hx, -15 + hy, 1, 1, "#7a2b25"); }
      else P(-1 + hx + look, -16 + hy, 2, 1, "#b5534a");
      // head accessories
      if (L.acc === "beret") { P(-5 + hx, -25 + hy, 10, 2, "#e23b55"); P(-1 + hx, -26 + hy, 2, 1, "#e23b55"); P(-5 + hx, -24 + hy, 10, 1, "#b82a43"); }
      if (L.acc === "phones") { P(-5 + hx, -25 + hy, 10, 1, "#222"); P(-6 + hx, -21 + hy, 2, 4, "#222"); P(4 + hx, -21 + hy, 2, 4, "#222"); P(-6 + hx, -20 + hy, 1, 2, "#1fa35b"); }

      // arms by activity
      const arm = L.shade, skin = L.skin;
      if (c.jump > 0 || c.act === "cheer") {
        P(-7, -21 + b, 2, 7, arm); P(5, -21 + b, 2, 7, arm); P(-7, -22 + b, 2, 1, skin); P(5, -22 + b, 2, 1, skin);
      } else if (c.carrying) {
        P(-6, -13 + b, 2, 4, arm); P(4, -13 + b, 2, 4, arm); P(-4, -10 + b, 9, 1, skin);
        P(1, -14 + b, 6, 7, "#ffffff"); P(2, -12 + b, 4, 1, "#b9b9c9"); P(2, -10 + b, 3, 1, "#b9b9c9");
      } else if (c.mode === "sit" && (c.act === "type" || c.act === "run")) {
        const f = Math.floor(t * (c.act === "type" ? 12 : 6) + c.cx) % 2;
        P(-7, -14 + b, 2, 4, arm); P(5, -14 + b, 2, 4, arm);
        P(-6, -10 + b, 4, 2, arm); P(3, -10 + b, 4, 2, arm);
        P(-3, -9 + b - f, 2, 1, skin); P(2, -9 + b - (1 - f), 2, 1, skin);
      } else if (c.act === "think") {
        P(-7, -14 + b, 2, 7, arm); P(-7, -7 + b, 2, 1, skin);
        P(5, -14 + b, 2, 3, arm); P(3, -16 + hy, 3, 2, skin);
      } else if (c.act === "read") {
        P(-7, -14 + b, 2, 6, arm); P(5, -14 + b, 2, 6, arm); P(-6, -8 + b, 2, 1, skin); P(4, -8 + b, 2, 1, skin);
      } else {
        const sw = walking ? (wf === 1 ? -1 : wf === 3 ? 1 : 0) : 0;
        P(-7, -14 + b + sw, 2, 7, arm); P(5, -14 + b - sw, 2, 7, arm);
        P(-7, -7 + b + sw, 2, 1, skin); P(5, -7 + b - sw, 2, 1, skin);
        if (L.acc === "clip" && !walking) { P(6, -12 + b, 4, 5, "#d9c2a0"); P(7, -13 + b, 2, 1, "#888"); P(7, -10 + b, 2, 1, "#ffffff"); }
      }
      // thinking dots
      if (c.act === "think" && c.mode === "sit") {
        const n = Math.floor(t * 3) % 4;
        for (let i = 0; i < n; i++) R(c.x - 3 + i * 3, c.y - 30, 2, 2, "#ffffff");
      }
      // sweat
      if (c.sweat > 0) { const s = Math.floor((1 - (c.sweat % 1)) * 5); R(c.x + 5 * d, c.y - 23 + s, 1, 2, "#8fd8ff"); }
    }

    function drawCat(t) {
      const x = Math.round(cat.x), y = 166, d = cat.dir;
      const P = (dx, dy, w, h, col) => R(d > 0 ? x + dx : x - dx - w + 1, y + dy, w, h, col);
      const o = "#f4a259", o2 = "#d9823a";
      R(x - 6, y, 12, 1, "rgba(0,0,0,.18)");
      if (cat.state === "sleep") {
        P(-5, -4, 10, 4, o); P(-5, -4, 10, 1, o2); P(2, -6, 4, 3, o); P(2, -7, 1, 1, o); P(5, -7, 1, 1, o);
        P(3, -5, 2, 1, "#5a3a20");
        const z = (t * .6) % 1; text(ctx, "Z", x + 6 * d, y - 10 - Math.floor(z * 8), `rgba(255,255,255,${1 - z})`);
        return;
      }
      const f = cat.state === "walk" ? Math.floor(t * 8) % 2 : 0;
      const tail = Math.round(Math.sin(t * (cat.state === "sit" ? 3 : 6)));
      P(-6, -7 + tail, 1, 4, o2); P(-5, -4, 8, 3, o); P(-5, -4, 8, 1, o2);
      P(-4, -1, 1, 1, o2); P(-1 + f, -1, 1, 1, o2); P(1, -1, 1, 1, o2); P(3 - f, -1, 1, 1, o2);
      P(2, -8, 5, 5, o); P(2, -9, 1, 1, o); P(6, -9, 1, 1, o); P(5, -7, 1, 1, "#1b1b1b"); P(6, -5, 1, 1, "#ff9a9a");
    }

    // ---- simulation ----
    function stepChar(c, dt) {
      c.blinkAt -= dt; if (c.blinkAt <= 0) { c.blink = .12; c.blinkAt = 2 + Math.random() * 4; }
      if (c.blink > 0) c.blink -= dt;
      if (c.sweat > 0) c.sweat -= dt;
      if (c.shake > 0) c.shake -= dt;
      if (c.jump > 0) { c.jump -= dt; if (c.jump <= 0) { c.jump = 0; if (c.act === "cheer") c.act = c.prevAct || "idle"; } }
      if (c.moodT > 0) { c.moodT -= dt; if (c.moodT <= 0) c.mood = 0; }
      if (c.mode === "walk") {
        const tgt = c.path[0];
        if (!tgt) { c.mode = "sit"; c.dir = 1; return; }
        if (tgt.wait != null) { tgt.wait -= dt; if (tgt.wait <= 0) { tgt.done && tgt.done(); c.path.shift(); } return; }
        const sp = 85 * dt, dx = tgt.x - c.x, dy = tgt.y - c.y, dist = Math.hypot(dx, dy);
        if (Math.abs(dx) > .5) c.dir = dx > 0 ? 1 : -1;
        c.walkT += dt;
        if (dist <= sp) { c.x = tgt.x; c.y = tgt.y; tgt.done && tgt.done(); c.path.shift(); }
        else { c.x += dx / dist * sp; c.y += dy / dist * sp; }
      }
    }
    function stepCat(dt) {
      cat.t += dt; cat.next -= dt;
      if (cat.state === "walk") {
        cat.x += cat.dir * 14 * dt;
        if (cat.x < 12) { cat.x = 12; cat.dir = 1; } if (cat.x > W - 12) { cat.x = W - 12; cat.dir = -1; }
      }
      if (cat.next <= 0) {
        const r = Math.random();
        cat.state = r < .5 ? "walk" : r < .8 ? "sit" : "sleep";
        if (cat.state === "walk" && Math.random() < .5) cat.dir *= -1;
        cat.next = cat.state === "sleep" ? 8 + Math.random() * 8 : 3 + Math.random() * 5;
      }
    }
    function stepFx(dt) {
      confetti = confetti.filter(p => (p.life -= dt) > 0);
      confetti.forEach(p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 20 * dt; p.vx *= .99; });
      flyers = flyers.filter(f => (f.t += dt) < f.dur);
    }

    // ---- main loop ----
    let last = performance.now(), T = 0;
    function frame(now) {
      const dt = Math.min(.05, (now - last) / 1000); last = now; T += dt;
      const night = dark.matches;
      Object.values(chars).forEach(c => stepChar(c, dt)); stepCat(dt); stepFx(dt);
      drawRoom(T, night);
      const list = Object.values(chars);
      list.forEach(c => drawDesk(c, T));
      const behind = c => c.mode === "sit" || c.y < 134;
      list.filter(behind).forEach(c => drawChar(c, T));
      list.forEach(c => drawDeskFront(c, T, night));
      flyers.forEach(f => { const p = f.t / f.dur, x = f.x0 + (f.x1 - f.x0) * p, y = f.y0 + (f.y1 - f.y0) * p - Math.sin(p * Math.PI) * 14; R(x, y, 6, 4, "#fff"); R(x + 1, y + 1, 4, 1, "#b9b9c9"); });
      drawCat(T);
      list.filter(c => !behind(c)).sort((a, b) => a.y - b.y).forEach(c => drawChar(c, T));
      confetti.forEach(p => R(p.x, p.y, p.s, p.s, p.c));
      // bubbles follow heads
      list.forEach(c => {
        const b = c.bubble; if (!b) return;
        b.classList.toggle("walking", c.mode === "walk");
        b.style.left = (c.x / W * 100) + "%";
        b.style.bottom = ((H - (c.y - 31)) / H * 100) + "%";
      });
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // ---- public API ----
    const api = {
      work(id) { const c = chars[id]; if (!c) return; clearTimeout(c.hideT); c.act = "think"; c.working = true; api.focus(id); },
      rest(id) { const c = chars[id]; if (!c) return; c.act = "idle"; c.working = false; c.bubble.classList.remove("on");
        clearTimeout(c.hideT); c.hideT = setTimeout(() => { if (!c.working) c.bubble.classList.add("off"); }, 7000); },
      tool(id, kind) { const c = chars[id]; if (c && c.working) c.act = kind; },
      think(id) { const c = chars[id]; if (c && c.working) c.act = "think"; },
      focus(id) { Object.values(chars).forEach(c => c.bubble.classList.toggle("on", c.id === id)); },
      say(id, txt) { const c = chars[id]; if (!c) return; c.bubble.classList.remove("off"); c.bubble.querySelector("p").textContent = txt; },
      handoff(from, to, live) {
        const a = chars[from], b = chars[to]; if (!a || !b) return;
        if (!live || reduce) { b.papers++; return; }
        if (a.mode === "walk") { b.papers++; return; }
        const home = { x: a.cx + 4, y: DESK_Y };
        const standX = b.cx + (b.cx > a.cx ? -14 : 14);
        a.mode = "walk"; a.carrying = true; a.walkT = 0;
        a.path = [
          { x: a.cx + 4, y: WALK_Y },
          { x: standX, y: WALK_Y },
          { x: standX, y: 140 },
          { wait: .5, done: () => { a.carrying = false; flyers.push({ x0: standX, y0: 122, x1: b.cx + 13, y1: 104, t: 0, dur: .45 }); setTimeout(() => b.papers++, 450); } },
          { x: standX, y: WALK_Y },
          { x: a.cx + 4, y: WALK_Y },
          home,
        ];
      },
      qa(passed, live) {
        const q = chars.qa, e = chars.eng;
        if (!live) return;
        if (passed) api.celebrate(false);
        else { if (q) { q.shake = 1.2; q.mood = -1; q.moodT = 2; } if (e) { e.sweat = 3.5; e.mood = -1; e.moodT = 3.5; } }
      },
      celebrate(big) {
        Object.values(chars).forEach((c, i) => { if (c.mode === "sit") { c.prevAct = c.act === "cheer" ? c.prevAct : c.act; c.act = "cheer"; c.jump = big ? 2.4 : 1.4; c.mood = 1; c.moodT = big ? 4 : 2.5; } });
        if (reduce) return;
        const cols = ["#ff5a4e", "#ffd25e", "#1fa35b", "#1c8fd6", "#8a4fd8", "#ff9fb2", "#ffffff"];
        for (let i = 0; i < (big ? 160 : 70); i++) confetti.push({ x: Math.random() * W, y: -Math.random() * 40, vx: (Math.random() - .5) * 30, vy: 10 + Math.random() * 30, s: Math.random() < .3 ? 2 : 1, c: cols[i % cols.length], life: 4 + Math.random() * 2 });
      },
      done(passed, live) { if (live && passed) api.celebrate(true); Object.values(chars).forEach(c => { c.act = "idle"; c.working = false; }); },
      board(o) {
        if (o.stage) board.stage = STAGE[o.stage] || board.stage;
        if (o.round != null) { board.round = o.round; board.max = o.max; }
        if (o.score != null) board.score = o.score || (board.score ?? null);
      },
      reset() {
        Object.values(chars).forEach(c => { Object.assign(c, { x: c.cx + 4, y: DESK_Y, mode: "sit", act: "idle", path: [], carrying: false, papers: 0, working: false, mood: 0 }); c.bubble.classList.add("off"); c.bubble.classList.remove("on"); });
        board = { stage: "BRIEF", round: 0, max: 0, score: null }; confetti = []; flyers = [];
      },
    };
    return api;
  }
  window.PixelOffice = { mount };
})();
