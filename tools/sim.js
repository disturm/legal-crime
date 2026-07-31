// Прогон партий ботом — проверка баланса и того, что игра вообще проходима.
//   node tools/sim.js <mode> [N]
//   mode: mass — разводит бойцов по разным целям и держит охрану штаба
//                (основной сценарий «нормальной игры»: точку тянет один сильнейший,
//                 поэтому копить толпу под одну цель больше не имеет смысла)
//         bot  — слабая стратегия: всё кучей в одну ближайшую точку
//         idle — игрок ничего не делает (должен проигрывать всегда)
// Карта генерируется случайно и НЕ сидируется, разброс большой:
// одиночный прогон ничего не доказывает, гоняйте N >= 20.
const { loadGame } = require("./harness");

function play(g, mode, aiCount) {
  g.reset(aiCount);                          // новый мир с нужным числом ИИ-противников
  let t = 0, peakEnemy = 0;
  for (let i = 0; i < 12000 && !g.ended; i++) {
    g.update(0.05); t += 0.05;
    peakEnemy = Math.max(peakEnemy, g.units.filter(u => u.team !== "player").length);
    if (mode === "idle") continue;
    if (i % 20) continue;

    const mine = g.businesses.filter(b => b.owner === "player");
    if (!mine.length) continue;
    const h = mine[0];
    // покупка через обычный найм: он же снимает взятку за ещё закрытый класс.
    // Дешёвое ядро, дорогие классы — когда экономика позволяет.
    const ty = g.money >= 900 ? "sniper" : g.money >= 400 ? "shooter" : "bouncer";
    g.selectBuy(ty);

    const my = g.units.filter(u => u.team === "player");
    const free = my.filter(u => !u.captureBiz || u.captureBiz.owner === "player");
    const targets = g.businesses.filter(b => b.owner !== "player");
    if (!targets.length) continue;

    if (mode === "bot") {                       // слабая стратегия: всё в одну точку кучей
      if (free.length < 4) continue;
      let best = targets[0], bd = 1e9;
      targets.forEach(b => { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < bd) { bd = d; best = b; } });
      const spots = g.captureSpots(best);
      free.sort((a, b) => b.pow - a.pow).forEach((u, k) => {
        u.captureBiz = best; u.order = "capture";
        const s = spots.length ? spots[k % spots.length] : best;
        const j = k ? 8 : 0;
        g.setDest(u, s.x + (Math.random() * 2 - 1) * j, s.y + (Math.random() * 2 - 1) * j);
      });
      continue;
    }

    // mass: точку тянет один сильнейший, поэтому копить толпу бессмысленно —
    // нормальная игра теперь это развести бойцов по разным целям.
    // Двое всегда дома, и «дома» значит в зоне захвата штаба: ИИ ставит охрану так же,
    // иначе сравнение бота с ИИ нечестное.
    const hq = g.playerHQ();
    const hqSpots = hq ? g.captureSpots(hq) : [];
    const guards = hqSpots.length ? free.slice(0, 2) : [];
    guards.forEach((u, k) => {
      if (g.inCapZone(hq, u)) return;
      u.order = null; u.target = null; u.captureBiz = null;
      const s = hqSpots[k % hqSpots.length];
      g.setDest(u, s.x, s.y);
    });

    // Каждому свободному бойцу — ближайшая ненасыщенная цель. Один боец берёт
    // только нейтралку: чужую точку сперва надо очистить от гарнизона, поэтому
    // с ростом армии на цель идёт несколько бойцов.
    const squad = free.slice(guards.length).sort((a, b) => b.pow - a.pow);
    const load = new Map(targets.map(b => [b, 0]));
    g.units.forEach(u => {
      if (u.team === "player" && u.captureBiz && load.has(u.captureBiz))
        load.set(u.captureBiz, load.get(u.captureBiz) + 1);
    });
    const perTarget = Math.max(1, Math.ceil(my.length / targets.length));
    squad.forEach(u => {
      let best = null, bd = 1e9;
      targets.forEach(b => {
        if (load.get(b) >= perTarget) return;
        const d = Math.hypot(b.x - u.x, b.y - u.y); if (d < bd) { bd = d; best = b; }
      });
      if (!best) targets.forEach(b => {          // всё насыщено — просто к ближайшей
        const d = Math.hypot(b.x - u.x, b.y - u.y); if (d < bd) { bd = d; best = b; }
      });
      if (!best) return;
      const k = load.get(best) || 0; load.set(best, k + 1);
      u.captureBiz = best; u.order = "capture";
      const spots = g.captureSpots(best);
      const s = spots.length ? spots[k % spots.length] : best;
      const j = k ? 8 : 0;
      g.setDest(u, s.x + (Math.random() * 2 - 1) * j, s.y + (Math.random() * 2 - 1) * j);
    });
  }
  return {
    sec: Math.round(t), win: g.outcome === "win", ended: g.ended,
    mine: g.businesses.filter(b => b.owner === "player").length, total: g.businesses.length,
    players: g.units.filter(u => u.team === "player").length,
    peakEnemy, wave: g.wave, money: Math.round(g.money),
  };
}

const mode = process.argv[2] || "mass";
const N = +(process.argv[3] || 20);
const aiCount = +(process.argv[4] || 2);        // число ИИ-противников (1..3)
const rows = [];
for (let n = 0; n < N; n++) rows.push(play(loadGame(), mode, aiCount));
console.log(`${mode.toUpperCase()} — ${N} партий, ИИ: ${aiCount}`);
rows.forEach((r, i) => console.log(` #${i}`, JSON.stringify(r)));
const wins = rows.filter(r => r.win).map(r => r.sec);
console.log(` итог: побед ${wins.length}/${N}` +
  (wins.length ? `, время победы ${Math.min(...wins)}–${Math.max(...wins)} c` : ""));
