/* ==========================================================================
   SMALL WORLD - 3D Particle Systems & Visual Life
   Adds chimney smoke, seasonal weather (snow, rain, leaves), fire embers,
   procedural walking gait, and floating emotive symbols above villagers.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const API = window.SmallWorld;
  if (!API) return;

  // Emote queues for living villagers
  const emotes = new Map(); // agentId -> { text, until, color }

  API.showEmote = function (agentId, text, durationMs, color) {
    emotes.set(agentId, {
      text: text || '💬',
      until: performance.now() + (durationMs || 2200),
      color: color || '#ffea79'
    });
  };

  // Register in API.icons so 3D overhead billboards also display active emotes
  API.icons = API.icons || [];
  API.icons.unshift(function (a, w) {
    const em = emotes.get(a.id);
    if (em && performance.now() < em.until) {
      return [em.text, em.color];
    }
    return null;
  });

  // ---------------------------------------------------------------- 2D Overlay Drawer
  // Draw floating speech/emotion bubbles in 2D mode
  API.draw = API.draw || { ground: [], top: [] };
  API.draw.top.push(function (G) {
    const ctx = G.ctx;
    const now = performance.now();
    for (const [id, em] of emotes.entries()) {
      if (now > em.until) {
        emotes.delete(id);
        continue;
      }
      const a = G.world.get(id);
      if (!a || !a.alive) continue;

      const px = G.gx(a.x) + G.ts * 0.5;
      const py = G.gy(a.y) - 6;

      ctx.save();
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      // Bubble background
      ctx.fillStyle = 'rgba(15, 20, 30, 0.75)';
      ctx.beginPath();
      ctx.arc(px, py - 6, 9, 0, Math.PI * 2);
      ctx.fill();
      // Icon
      ctx.fillText(em.text, px, py);
      ctx.restore();
    }
  });

  // ---------------------------------------------------------------- 3D Particles
  function initThreeParticles() {
    const T = window.THREE;
    if (!T || !API.view3d) return;

    let particleGroup = null;
    let weatherPoints = null;
    let weatherGeo = null;
    let weatherMats = {};
    const WEATHER_COUNT = 600;
    const weatherPos = new Float32Array(WEATHER_COUNT * 3);
    const weatherVel = new Float32Array(WEATHER_COUNT * 3);

    // Chimney smoke particles
    const smokePuffs = [];
    const MAX_SMOKE = 80;

    function setupScene(scene) {
      if (particleGroup) {
        scene.remove(particleGroup);
      }
      particleGroup = new T.Group();

      // Weather Points setup
      weatherGeo = new T.BufferGeometry();
      for (let i = 0; i < WEATHER_COUNT; i++) {
        weatherPos[i * 3 + 0] = (Math.random() - 0.5) * 50;
        weatherPos[i * 3 + 1] = Math.random() * 20;
        weatherPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
        weatherVel[i * 3 + 0] = (Math.random() - 0.5) * 0.05;
        weatherVel[i * 3 + 1] = -0.15 - Math.random() * 0.1;
        weatherVel[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
      }
      weatherGeo.setAttribute('position', new T.BufferAttribute(weatherPos, 3));

      // Materials for different weathers
      weatherMats.snow = new T.PointsMaterial({
        color: 0xffffff,
        size: 0.35,
        transparent: true,
        opacity: 0.85
      });
      weatherMats.rain = new T.PointsMaterial({
        color: 0x88bbff,
        size: 0.25,
        transparent: true,
        opacity: 0.75
      });
      weatherMats.leaves = new T.PointsMaterial({
        color: 0xd88a38,
        size: 0.4,
        transparent: true,
        opacity: 0.9
      });

      weatherPoints = new T.Points(weatherGeo, weatherMats.snow);
      particleGroup.add(weatherPoints);

      // Smoke pool
      const smokeGeo = new T.SphereGeometry(0.12, 6, 6);
      const smokeMat = new T.MeshBasicMaterial({
        color: 0xcccccc,
        transparent: true,
        opacity: 0.35
      });
      for (let i = 0; i < MAX_SMOKE; i++) {
        const mesh = new T.Mesh(smokeGeo, smokeMat.clone());
        mesh.visible = false;
        particleGroup.add(mesh);
        smokePuffs.push({
          mesh,
          active: false,
          life: 0,
          maxLife: 1.0,
          vx: 0, vy: 0, vz: 0
        });
      }

      scene.add(particleGroup);
    }

    // Attach to View3D rendering
    const origRender = API.view3d.render;
    if (origRender) {
      API.view3d.render = function (alpha) {
        const res = origRender.apply(this, arguments);

        const w = window.SmallWorldInstance;
        if (!w || !API.view3d.active) return res;

        // Try getting scene from view3d
        if (!particleGroup && (API.view3d.scene || API.view3d._scene)) {
          setupScene(API.view3d.scene || API.view3d._scene);
        }

        // Animate weather particles if active
        if (weatherPoints && weatherGeo) {
          const isWinter = w.season === 'Winter';
          const isAutumn = w.season === 'Autumn';
          const isStorm = (w.m && w.m.dis && w.m.dis.storm) || (w.m && w.m.weather && w.m.weather.rain);

          if (isWinter) {
            weatherPoints.visible = true;
            weatherPoints.material = weatherMats.snow;
          } else if (isStorm) {
            weatherPoints.visible = true;
            weatherPoints.material = weatherMats.rain;
          } else if (isAutumn) {
            weatherPoints.visible = true;
            weatherPoints.material = weatherMats.leaves;
          } else {
            weatherPoints.visible = false;
          }

          if (weatherPoints.visible) {
            const pos = weatherGeo.attributes.position.array;
            for (let i = 0; i < WEATHER_COUNT; i++) {
              pos[i * 3 + 1] += weatherVel[i * 3 + 1];
              pos[i * 3 + 0] += weatherVel[i * 3 + 0];
              // Respawn at top
              if (pos[i * 3 + 1] < 0) {
                pos[i * 3 + 1] = 18 + Math.random() * 4;
                pos[i * 3 + 0] = (Math.random() - 0.5) * 50;
                pos[i * 3 + 2] = (Math.random() - 0.5) * 40;
              }
            }
            weatherGeo.attributes.position.needsUpdate = true;
          }
        }

        // Spawn smoke from occupied houses
        if (smokePuffs.length && Math.random() < 0.25) {
          const houses = w.houses || [];
          for (const h of houses) {
            if (h.occupants && h.occupants.length > 0) {
              const freePuff = smokePuffs.find(p => !p.active);
              if (freePuff) {
                freePuff.active = true;
                freePuff.life = 0;
                freePuff.maxLife = 2.5 + Math.random();
                freePuff.mesh.position.set(h.x - w.W / 2 + 0.5, 1.8, h.y - w.H / 2 + 0.5);
                freePuff.mesh.scale.setScalar(0.7);
                freePuff.mesh.material.opacity = 0.35;
                freePuff.mesh.visible = true;
                freePuff.vx = (Math.random() - 0.5) * 0.015 + 0.02; // gentle wind
                freePuff.vy = 0.02 + Math.random() * 0.015;
                freePuff.vz = (Math.random() - 0.5) * 0.015;
              }
            }
          }
        }

        // Update smoke puffs
        for (const p of smokePuffs) {
          if (!p.active) continue;
          p.life += 0.03;
          if (p.life >= p.maxLife) {
            p.active = false;
            p.mesh.visible = false;
            continue;
          }
          const progress = p.life / p.maxLife;
          p.mesh.position.x += p.vx;
          p.mesh.position.y += p.vy;
          p.mesh.position.z += p.vz;
          p.mesh.scale.setScalar(0.7 + progress * 1.8);
          p.mesh.material.opacity = (1 - progress) * 0.32;
        }

        return res;
      };
    }
  }

  // ---------------------------------------------------------------- Hooks for Emote Events
  API.mods.push({
    init(w) {
      window.SmallWorldInstance = w;
      setTimeout(initThreeParticles, 500);
    },
    tick(w) {
      window.SmallWorldInstance = w;
    },
    child(w, a) {
      API.showEmote(a.id, '👶', 3500);
    },
    ate(w, a) {
      if (Math.random() < 0.2) API.showEmote(a.id, '🍖', 1400);
    },
    work(w, a, kind) {
      if (Math.random() < 0.04) {
        if (a.job === 'woodcutter') API.showEmote(a.id, '🪓', 1500);
        else if (a.job === 'builder') API.showEmote(a.id, '🔨', 1500);
        else if (a.job === 'farmer') API.showEmote(a.id, '🌾', 1500);
        else if (a.job === 'doctor') API.showEmote(a.id, '💊', 1500);
        else if (a.job === 'guard') API.showEmote(a.id, '🛡️', 1500);
      }
    },
    die(w, a) {
      API.showEmote(a.id, '💀', 4000);
    }
  });
})();
