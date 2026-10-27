/* ==========================================================================
   SMALL WORLD - Emergent Multi-Agent Social Life
   Gives every villager contextual dialogue, spatial encounters, reaction bubbles,
   friendship dynamics, and a "Village Chatter" live feed.
   Zero LLM latency: runs instantaneously at 60 FPS in vanilla JavaScript.
   ========================================================================== */
(function () {
  'use strict';
  const api = typeof module !== 'undefined' && module.exports ? require('../sim.js') : window.SmallWorld;
  const { clamp, hash01 } = api.util;

  const S = w => w.m.social || (w.m.social = { chatter: [], lastTick: 0 });

  // Dialogue templates tailored to personality, situation, and relationships
  const DIALOGUES = {
    hungry: [
      "My stomach is growling... I hope we have food left in the store.",
      "The food supplies look meager today. We must harvest soon.",
      "I'm feeling weak. Is there any bread to spare?"
    ],
    winter: [
      "The frost is biting! Make sure we keep the fires stoked.",
      "I can hardly feel my fingers out in this blizzard.",
      "Winter is harsh this year... stay close to the hearth."
    ],
    storm: [
      "Take shelter! The skies are tearing open!",
      "I hope the roofs hold against this tempest."
    ],
    workmates: [
      "Good rhythm today! We'll have this task done in no time.",
      "Careful with that timber, lift with your knees.",
      "Hard work keeps the winter hunger away."
    ],
    rivals: [
      "Keep moving. I don't need your advice.",
      "You again? Go bother someone else.",
      "Don't get in my way today."
    ],
    friends: [
      "Always good to see your face around here, friend.",
      "Let's grab a meal together once our work is done.",
      "How are you holding up? Let me know if you need a hand."
    ],
    grief: [
      "The village feels emptier without those we lost.",
      "I still keep looking for them... it hurts to see their empty bed."
    ],
    idle: [
      "The lake looks so quiet today.",
      "Looks like fair weather ahead.",
      "Did you see the trader by the market stalls?"
    ]
  };

  function pickDialogue(w, a, b) {
    const rel = (a.rel && a.rel[b.id]) || 0;
    // Check urgent context
    if (a.satiety < 25 || b.satiety < 25) {
      const list = DIALOGUES.hungry;
      return { topic: 'hunger', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.day) * list.length)], emote: '🍖' };
    }
    if (w.season === 'Winter') {
      const list = DIALOGUES.winter;
      return { topic: 'cold', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.tick) * list.length)], emote: '❄️' };
    }
    if (rel < -25) {
      const list = DIALOGUES.rivals;
      return { topic: 'rivalry', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.tick) * list.length)], emote: '⚡' };
    }
    if (rel > 35) {
      const list = DIALOGUES.friends;
      return { topic: 'friendship', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.tick) * list.length)], emote: '❤️' };
    }
    if (a.job === b.job && a.job !== 'child') {
      const list = DIALOGUES.workmates;
      return { topic: 'work', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.tick) * list.length)], emote: '🤝' };
    }
    const list = DIALOGUES.idle;
    return { topic: 'general', text: list[Math.floor(hash01(w.seed, a.id, b.id, w.tick) * list.length)], emote: '💬' };
  }

  api.mods.push({
    tick(w) {
      const s = S(w);
      // Run emergent encounters periodically (every 18 ticks)
      if (w.tick - s.lastTick < 18) return;
      s.lastTick = w.tick;

      const agents = w.agents;
      if (agents.length < 2) return;

      // Select two nearby agents
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (!a.alive || a.sleeping) continue;

        for (let j = i + 1; j < agents.length; j++) {
          const b = agents[j];
          if (!b.alive || b.sleeping) continue;

          const dx = a.x - b.x, dy = a.y - b.y;
          const distSq = dx * dx + dy * dy;

          // Encounter within 2 tiles
          if (distSq <= 4.0) {
            // Check cooldown between this specific pair
            a._lastChat = a._lastChat || {};
            if (w.tick - (a._lastChat[b.id] || -999) < 140) continue;
            a._lastChat[b.id] = w.tick;

            const chat = pickDialogue(w, a, b);

            // Record into village chatter feed
            s.chatter.unshift({
              day: w.day,
              tick: w.tick,
              speaker: a.name,
              listener: b.name,
              text: chat.text,
              topic: chat.topic
            });
            if (s.chatter.length > 25) s.chatter.pop();

            // Display visual emote over their heads if running in browser
            if (typeof window !== 'undefined' && api.showEmote) {
              api.showEmote(a.id, chat.emote, 2400);
              api.showEmote(b.id, '👂', 2000);
            }

            // Relationship & mood nudge
            if (chat.topic === 'rivalry') {
              if (a.rel) a.rel[b.id] = clamp((a.rel[b.id] || 0) - 2, -100, 100);
            } else if (chat.topic === 'friendship' || chat.topic === 'work') {
              if (a.rel) a.rel[b.id] = clamp((a.rel[b.id] || 0) + 1.5, -100, 100);
              a.mood = Math.min(100, a.mood + 1.2);
              b.mood = Math.min(100, b.mood + 1.2);
            }

            // Stop after one social exchange per check
            return;
          }
        }
      }
    }
  });

  // Sidebar Panel: Live Village Chatter
  api.panels.push({
    id: 'social',
    title: 'Village Chatter & Social',
    html(w) {
      const s = S(w);
      if (!s.chatter.length) {
        return '<div class="muted">Villagers will chat as they cross paths.</div>';
      }
      return '<div class="social-feed">' + s.chatter.slice(0, 7).map(c => `
        <div class="chat-entry" style="margin-bottom:6px; font-size:12px; line-height:1.4;">
          <strong style="color:#818cf8;">${c.speaker}</strong> to <strong style="color:#a78bfa;">${c.listener}</strong>:
          <span style="color:#e2e8f0; font-style:italic;">"${c.text}"</span>
        </div>
      `).join('') + '</div>';
    }
  });
})();
