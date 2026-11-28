/*
 * Spectral field — BreathDearMedusae's particle engine, ported to one canvas.
 *
 * The values below are the reference configuration, kept in the reference's
 * world units and converted to screen pixels through CAMERA_UNITS (the height
 * of the R3F viewport at fov 75, camera z 5). The halo is the jellyfish ring:
 * it breathes, wobbles with shape noise, pushes what it passes, and the outer
 * oscillation moves everything beyond it.
 */
(() => {
  const field = document.querySelector("[data-spectral]");
  if (!field) return;
  const canvas = field.querySelector("[data-spectral-canvas]");
  if (!canvas || !canvas.getContext) return;
  const context = canvas.getContext("2d");
  if (!context) return;

  const CONFIG = {
    cursor: {
      radius: 0.065,
      strength: 0.05,
      dragFactor: 0.015,
    },
    halo: {
      outerOscFrequency: 2.6,
      outerOscAmplitude: 0.76,
      outerOscJitterStrength: 0.025,
      outerOscJitterSpeed: 0.3,
      radiusBase: 2.4,
      radiusAmplitude: 0.5,
      shapeAmplitude: 0.75,
      rimWidth: 1.8,
      outerStartOffset: 0.4,
      outerEndOffset: 2.2,
      scaleX: 1.3,
      scaleY: 1,
    },
    particles: {
      baseSize: 0.016,
      activeSize: 0.044,
      blobScaleX: 1,
      blobScaleY: 0.6,
      rotationSpeed: 0.1,
      rotationJitter: 0.2,
      cursorFollowStrength: 1,
      oscillationFactor: 1,
      colorBase: "#000000",
      colorOne: "#1e4e2c",
      colorTwo: "#4d6869",
      colorThree: "#bd9a45",
    },
    background: {
      color: "#ffffff",
    },
  };

  /* Dark mode keeps the same hues, lifted so they read on a dark page. */
  const DARK_COLORS = {
    colorBase: "#e7efe9",
    colorOne: "#5fbf88",
    colorTwo: "#8fb3b6",
    colorThree: "#e0c076",
  };

  const CAMERA_UNITS = 7.67;
  const GRID_WIDTH = 40;
  const GRID_HEIGHT = 22;
  const GRID_X = 100;
  const GRID_Y = 55;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const smoothstep = (edge0, edge1, value) => {
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };

  const parseHex = (hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const mix = (a, b, t) => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

  let theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  let width = 1;
  let height = 1;
  let unit = 1;
  let ratio = 1;
  let particles = [];
  let baseSprite = null;
  let tintSprites = [];

  const dot = (rgb) => {
    const size = 24;
    const sprite = document.createElement("canvas");
    sprite.width = size;
    sprite.height = size;
    const paint = sprite.getContext("2d");
    if (!paint) return sprite;
    const glow = paint.createRadialGradient(12, 12, 0, 12, 12, 12);
    glow.addColorStop(0, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},1)`);
    glow.addColorStop(0.74, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0.96)`);
    glow.addColorStop(1, `rgba(${rgb[0] | 0},${rgb[1] | 0},${rgb[2] | 0},0)`);
    paint.fillStyle = glow;
    paint.beginPath();
    paint.arc(12, 12, 12, 0, Math.PI * 2);
    paint.fill();
    return sprite;
  };

  const buildSprites = () => {
    const colors = theme === "dark"
      ? { ...CONFIG.particles, ...DARK_COLORS }
      : CONFIG.particles;
    const base = parseHex(colors.colorBase);
    const one = parseHex(colors.colorOne);
    const two = parseHex(colors.colorTwo);
    const three = parseHex(colors.colorThree);
    baseSprite = dot(base);
    tintSprites = [];
    for (let i = 0; i < 6; i += 1) {
      for (let j = 0; j < 6; j += 1) {
        const p1 = (i / 5) * 2 - 1;
        const p2 = (j / 5) * 2 - 1;
        let active = mix(one, two, p1 * 0.5 + 0.5);
        active = mix(active, three, p2 * 0.5 + 0.5);
        tintSprites.push(dot(active));
      }
    }
  };

  const seed = () => {
    unit = height / CAMERA_UNITS;
    const halfWidth = width / unit / 2;
    const halfHeight = height / unit / 2;
    const stepX = GRID_WIDTH / (GRID_X - 1);
    const stepY = GRID_HEIGHT / (GRID_Y - 1);
    const jitter = 0.25;
    const next = [];
    for (let y = -halfHeight - 1; y <= halfHeight + 1; y += stepY) {
      for (let x = -halfWidth - 1; x <= halfWidth + 1; x += stepX) {
        next.push({
          x: x + (Math.random() - 0.5) * jitter,
          y: y + (Math.random() - 0.5) * jitter,
          random: Math.random(),
        });
      }
    }
    particles = next;
  };

  /* The pointer, eased the way the reference eases uMouse. */
  const pointer = {
    targetX: 0,
    targetY: 0,
    x: 0,
    y: 0,
    inside: false,
    strength: 0,
    seeded: false,
  };

  const draw = (now, dt) => {
    context.clearRect(0, 0, width, height);
    const time = now * 0.001;
    const { cursor, halo, particles: shape } = CONFIG;
    const strength = pointer.strength;

    /* pointer target in world units, with the tiny reference jitter */
    const minWorld = Math.min(width, height) / unit;
    const jitterRadius = minWorld * cursor.radius;
    const jitterX = (Math.sin(time * 0.35) + Math.sin(time * 0.77 + 1.2)) * 0.5;
    const jitterY = (Math.cos(time * 0.31) + Math.sin(time * 0.63 + 2.4)) * 0.5;
    const targetX =
      (pointer.targetX - width / 2) / unit +
      jitterX * jitterRadius * cursor.strength * shape.cursorFollowStrength;
    const targetY =
      -(pointer.targetY - height / 2) / unit +
      jitterY * jitterRadius * cursor.strength * shape.cursorFollowStrength;

    const ease = 1 - Math.pow(1 - cursor.dragFactor, dt / 16.666);
    pointer.x += (targetX - pointer.x) * ease;
    pointer.y += (targetY - pointer.y) * ease;
    pointer.strength += ((pointer.inside ? 1 : 0) - pointer.strength) * ease * 1.6;

    const mouseX = pointer.x;
    const mouseY = pointer.y;
    const breath = Math.sin(time * 0.8);
    const baseRadius = halo.radiusBase + breath * halo.radiusAmplitude;
    const pushAmount = (breath * 0.5 + 0.5) * 0.5;
    const outerJitter =
      Math.sin(time * halo.outerOscJitterSpeed * 6 + 1.7) * halo.outerOscJitterStrength;

    for (const particle of particles) {
      const flowX =
        Math.sin(time * 0.15 + particle.y * 0.5) +
        Math.sin(time * 0.15 * 0.5 + particle.y * 2);
      const flowY =
        Math.cos(time * 0.15 + particle.x * 0.5) +
        Math.cos(time * 0.15 * 0.5 + particle.x * 2);
      const px = particle.x + flowX * 0.25;
      const py = particle.y + flowY * 0.25;

      const relX = px - mouseX;
      const relY = py - mouseY;
      const sx = Math.max(halo.scaleX, 0.0001);
      const sy = Math.max(halo.scaleY, 0.0001);
      const distance = Math.hypot(relX / sx, relY / sy);
      const angle = Math.atan2(relY, relX);
      const length = Math.hypot(relX, relY) || 0.0001;
      const dirX = relX / length;
      const dirY = relY / length;

      /* shape noise: three bands of the ring radius, like the shader's noise */
      const shapeNoise =
        0.5 +
        0.3 * Math.sin(angle * 3 + time * 0.5) +
        0.16 * Math.sin(angle * 5 - time * 0.33) +
        0.08 * Math.sin(angle * 7 + time * 0.9);
      const currentRadius =
        baseRadius + clamp(shapeNoise, 0, 1) * halo.shapeAmplitude;
      const rim =
        smoothstep(halo.rimWidth, 0, Math.abs(distance - currentRadius)) * strength;
      const outer =
        smoothstep(
          baseRadius + halo.outerStartOffset,
          baseRadius + halo.outerEndOffset,
          distance,
        ) * strength;

      const push = pushAmount * rim;
      const outerWave =
        Math.sin(time * halo.outerOscFrequency + px * 0.6 + py * 0.6) *
        (halo.outerOscAmplitude + outerJitter) *
        outer;

      const screenX = width / 2 + (px + dirX * (push + outerWave)) * unit;
      const screenY = height / 2 - (py + dirY * (push + outerWave)) * unit;

      /* baseSize + activeSize, with the shader's slow size breathing */
      const size =
        (shape.baseSize +
          Math.sin(time + px) * 0.003 +
          rim * shape.activeSize) *
        unit * shape.blobScaleX;
      const drawHeight = size * shape.blobScaleY;
      if (size < 0.4) continue;

      const warmth1 = Math.sin(px * 0.8 + time * 1.2);
      const warmth2 = Math.sin(py * 0.8 + time * 1.2 * 0.8 + warmth1);
      const l1 = Math.round((warmth1 * 0.5 + 0.5) * 5);
      const l2 = Math.round((warmth2 * 0.5 + 0.5) * 5);
      const tint = tintSprites[l1 * 6 + l2] || tintSprites[0];
      const mixFactor = smoothstep(0.1, 0.8, rim);
      const alpha = 0.4 + (0.95 - 0.4) * rim;

      context.globalAlpha = alpha * (1 - mixFactor);
      context.drawImage(
        baseSprite,
        screenX - size / 2,
        screenY - drawHeight / 2,
        size,
        drawHeight,
      );

      if (mixFactor > 0.02) {
        context.globalAlpha = alpha * mixFactor;
        const rotation =
          Math.atan2(relY, relX) +
          Math.sin(
            time * shape.rotationSpeed +
              px * 0.35 +
              py * 0.35 +
              particle.random * 6.283,
          ) *
            shape.rotationJitter;
        if (size > 3) {
          context.save();
          context.translate(screenX, screenY);
          context.rotate(rotation);
          context.drawImage(tint, -size / 2, -drawHeight / 2, size, drawHeight);
          context.restore();
        } else {
          context.drawImage(
            tint,
            screenX - size / 2,
            screenY - drawHeight / 2,
            size,
            drawHeight,
          );
        }
      }
    }

    context.globalAlpha = 1;
  };

  let frame = 0;
  let last = 0;

  /* Ambient dust: 30fps is plenty and halves the compositor work. */
  const loop = (now) => {
    frame = window.requestAnimationFrame(loop);
    if (now - last < 30) return;
    const dt = Math.min(64, now - (last || now));
    last = now;
    draw(now, dt);
  };

  const start = () => {
    if (reduced || frame) return;
    last = 0;
    frame = window.requestAnimationFrame(loop);
  };

  const stop = () => {
    if (!frame) return;
    window.cancelAnimationFrame(frame);
    frame = 0;
  };

  const measure = () => {
    const rect = canvas.getBoundingClientRect();
    ratio = 1;
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    if (!pointer.seeded) {
      pointer.seeded = true;
      pointer.targetX = width * 0.5;
      pointer.targetY = height * 0.42;
      pointer.x = (pointer.targetX - width / 2) / (height / CAMERA_UNITS);
      pointer.y = -(pointer.targetY - height / 2) / (height / CAMERA_UNITS);
    }
    seed();
    buildSprites();
    draw(performance.now(), 0);
  };

  const track = (event) => {
    if (event.pointerType === "touch") return;
    pointer.targetX = event.clientX;
    pointer.targetY = event.clientY;
    pointer.inside = true;
  };

  buildSprites();
  measure();
  start();

  window.addEventListener("pointermove", track, { passive: true });
  window.addEventListener("pointerdown", track, { passive: true });
  document.addEventListener("pointerleave", () => {
    pointer.inside = false;
  });
  document.addEventListener("pointerenter", () => {
    pointer.inside = true;
  });
  window.addEventListener("blur", () => {
    pointer.inside = false;
  });

  let resizeTimer = 0;
  window.addEventListener(
    "resize",
    () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        measure();
        if (reduced) draw(performance.now(), 0);
      }, 160);
    },
    { passive: true },
  );

  new MutationObserver(() => {
    const next = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    if (next === theme) return;
    theme = next;
    buildSprites();
    if (reduced) draw(performance.now(), 0);
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });
})();
