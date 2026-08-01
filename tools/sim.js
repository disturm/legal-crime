// Прогон партий ботом — проверка баланса и того, что игра вообще проходима.
//   node tools/sim.js <mode> [N] [ИИ] [сид|rnd] [размер: small|normal|large] [nofog]
//
// ⛔ ИИ-АГЕНТУ ЗАПРЕЩЕНО ЗАПУСКАТЬ ЭТОТ СКРИПТ НА `large`. На большой карте бот доводит
// армию до сотни бойцов, а update квадратичен по юнитам: одна партия идёт до минуты
// реального времени. Замеры баланса на большой карте делает ПОЛЬЗОВАТЕЛЬ сам.
// Размер по умолчанию — `small` именно поэтому: случайный запуск обязан быть дешёвым.
//   mode: mass — разводит бойцов по разным целям и держит охрану штаба
//                (основной сценарий «нормальной игры»: точку тянет один сильнейший,
//                 поэтому копить толпу под одну цель больше не имеет смысла)
//         bot  — слабая стратегия: всё кучей в одну ближайшую точку
//         idle — игрок ничего не делает (должен проигрывать всегда)
// Карты по умолчанию СИДИРОВАНЫ от фиксированной базы: два прогона одного и того же кода
// дают одинаковый результат, и два варианта коэффициента можно сравнить на одних картах.
// Четвёртым аргументом можно задать свою базу сида или `rnd` — карты будут случайными,
// и тогда разброс возвращается, а одиночный прогон снова ничего не доказывает.
const { loadGame } = require("./harness");

// Запас в кассе на найм, который бот держит, покупая улучшение, берётся ИЗ ИГРЫ
// (AI_UP_RESERVE): у ИИ порог вложений в экономику ровно такой же. Свои числа здесь
// уже однажды сделали замер бессмысленным — бот ждал вдвое большей кассы, чем ИИ,
// и сим мерил не сложность, а то, кто раньше начал строить.
const BUY_RESERVE = 300;  // запас сверх цены дорогого класса: не проедать кассу одним наймом
// Та же доктрина, что у ИИ (UPKEEP_SHARE в игре): нанимаем, пока содержание не съело
// свою долю дохода. Без неё бот при новом upkeep проедает весь приток на армию,
// не доходит до улучшений и партия вырождается — то есть модель перестаёт быть
// моделью нормальной игры, а замер мерит не сложность, а плохую стратегию.
const UPKEEP_SHARE = 0.7;
const TICKS = 24000;      // предел партии: 1200 c игрового времени (карта 40x30 — длинные марши)

// Расстояние «по дорогам», а не по прямой. Через канал ближайшая по прямой цель может
// оказаться на другом берегу: отряд уйдёт в набережную и партия сгорит в таймаут.
// Одна волна BFS от бойца даёт расстояния сразу до всей карты.
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// Кэш на один такт решений: бойцы кучкуются, и волна из той же клетки — та же волна.
// Семантически это ничего не меняет, только снимает основную цену симуляции.
let fieldCache = new Map();
function distFieldCached(g, x, y) {
  const k = Math.floor(y / g.TILE) * g.COLS + Math.floor(x / g.TILE);
  let d = fieldCache.get(k);
  if (!d) { d = distField(g, x, y); fieldCache.set(k, d); }
  return d;
}
function distField(g, x, y) {
  const COLS = g.COLS, ROWS = g.ROWS, TL = g.TILE;
  const d = new Int32Array(COLS * ROWS).fill(-1);
  let c = Math.floor(x / TL), r = Math.floor(y / TL);
  if (!g.passable(c, r)) {                       // боец в стене/воде — берём ближайшую ходибельную
    let ok = false;
    for (let rad = 1; rad < 6 && !ok; rad++)
      for (let dr = -rad; dr <= rad && !ok; dr++) for (let dc = -rad; dc <= rad && !ok; dc++)
        if ((Math.abs(dr) === rad || Math.abs(dc) === rad) && g.passable(c + dc, r + dr)) { c += dc; r += dr; ok = true; }
    if (!ok) return d;
  }
  const start = r * COLS + c;
  d[start] = 0;
  const q = [start];
  for (let i = 0; i < q.length; i++) {
    const k = q[i], kc = k % COLS, kr = (k - kc) / COLS;
    for (const [dc, dr] of D4) {
      const nc = kc + dc, nr = kr + dr;
      if (nc < 0 || nr < 0 || nc >= COLS || nr >= ROWS) continue;
      const nk = nr * COLS + nc;
      if (d[nk] >= 0 || !g.passable(nc, nr)) continue;
      d[nk] = d[k] + 1; q.push(nk);
    }
  }
  return d;
}
// цель мерится по её точкам захвата: до самого заведения не дойти, оно непроходимо
function walkDist(g, d, b, fx, fy) {
  let best = Infinity;
  g.captureSpots(b).forEach(s => {
    const k = Math.floor(s.y / g.TILE) * g.COLS + Math.floor(s.x / g.TILE);
    if (d[k] >= 0 && d[k] < best) best = d[k];
  });
  // недостижимая цель не отбрасывается совсем: пусть она будет просто очень далёкой
  return best === Infinity ? 1e6 + Math.hypot(b.x - fx, b.y - fy) : best;
}

function play(g, mode, aiCount, seed, size, fog) {
  g.reset(aiCount, seed, size, fog);         // новый мир: число ИИ, размер карты и туман
  let t = 0, peakEnemy = 0;
  // Как и ИИ, бот специализируется на одном типе рынка: доля растёт только у того,
  // кто держит фокус, а голая жадность по «доход на доллар» сводит все партии к стриптизу.
  // Только доходные типы: тренировочный центр — не экономика, а логистика найма,
  // и модель «жадность по доходу на доллар» о нём сказать ничего не может.
  const fav = g.MARKET_KEYS[Math.floor(Math.random() * g.MARKET_KEYS.length)];
  for (let i = 0; i < TICKS && !g.ended; i++) {
    g.update(0.05); t += 0.05;
    peakEnemy = Math.max(peakEnemy, g.units.filter(u => u.team !== "player").length);
    if (mode === "idle") continue;
    if (i % 20) continue;
    fieldCache = new Map();          // новый такт решений — кэш волн сбрасывается

    const mine = g.businesses.filter(b => b.owner === "player");
    if (!mine.length) continue;
    const h = mine[0];
    // Улучшения — часть нормальной игры, поэтому модель обязана ими пользоваться:
    // иначе sim меряет не сложность, а «игрок не знает про механику».
    // ЭКОНОМИКА ИДЁТ ПЕРВОЙ, как и у ИИ (aiUpgrade вызывается в начале его такта):
    // найм каждую секунду не даёт кассе накопиться, и при обратном порядке ни одна
    // сторона не строит вообще — механика улучшений выпадает из модели целиком.
    if (mode === "mass") {
      const plain = mine.filter(b => !b.hq && !b.kind);
      let kind = null, bv = -1;
      g.MARKET_KEYS.forEach(k => {
        if (g.money < g.UPGRADES[k].cost + g.AI_UP_RESERVE) return;
        const v = g.upIncomeAt("player", k, 1) / g.UPGRADES[k].cost + (k === fav ? 0.02 : 0);
        if (v > bv) { bv = v; kind = k; }
      });
      if (plain.length && kind) {              // вкладываемся в тыл: ближняя к штабу точка живёт дольше
        let tgt = plain[0], td = 1e9;
        plain.forEach(b => { const d = Math.hypot(b.x - h.x, b.y - h.y); if (d < td) { td = d; tgt = b; } });
        g.buyUpgrade("player", tgt, kind);
      } else if (kind) {
        // Строить негде — перестраиваем самое слабое, по тому же правилу и тому же порогу,
        // что и ИИ: снос — часть нормальной игры, и модель игрока обязана им пользоваться,
        // иначе sim мерит не сложность, а незнание механики одной из сторон.
        const built = mine.filter(b => g.canDemolish("player", b) && b.kind !== kind);
        if (built.length) {
          let worst = built[0], wv = 1e9;
          built.forEach(b => { const v = g.bizIncomeOf("player", b); if (v < wv) { wv = v; worst = b; } });
          if (g.upIncomeAt("player", kind, 1) >= wv * g.AI_SWAP_GAIN) {
            g.demolish("player", worst);
            g.buyUpgrade("player", worst, kind);
          }
        }
      }
    }

    // Найм — из того, что осталось после вложений в экономику, и только пока содержание
    // не съело свою долю дохода (см. UPKEEP_SHARE). Цена закрытого класса включает взятку:
    // первый клик по нему уходит в неё, иначе бот платит и остаётся без бойца. Пороги
    // выведены из TYPES: цены связаны с содержанием правилом «минута = найм», и любое
    // число, вписанное здесь руками, с ними разъедется.
    const price = t => (g.unlocks.player[t] ? 0 : g.TYPES[t].bribe) + g.TYPES[t].cost;
    if (g.fUp.player < g.fInc.player * UPKEEP_SHARE) {
      let ty = null;
      for (const t of ["shooter", "sniper", "undertaker"])
        if (g.money >= price(t) + BUY_RESERVE) ty = t;
      if (!ty) {
        // Вышибала — тело для захвата, а не запасной боец: добирать им армию, когда
        // не хватило на стрелка, значит менять деньги на проигранные перестрелки.
        // Правило ровно то же, что у ИИ: первые BOUNCER_MIN тел свободно, дальше — доля,
        // а выбрав её, КОПИМ на взятку и стрелка вместо ещё одного тела.
        // Денежные ворота ИИ (BOUNCER_CASH: есть на пару стрелков — тела не берём)
        // отдельной строкой здесь не нужны, и это не поблажка боту, а следствие
        // порядка выше: до вышибалы ветка доходит, только когда стрелок с запасом
        // НЕ по карману, то есть бот и так строже порога в два стрелка.
        const my = g.units.filter(u => u.team === "player" && u.hp > 0);
        const b = my.filter(u => u.type === "bouncer").length;
        if (b < g.BOUNCER_MIN || b / my.length < g.BOUNCER_SHARE) ty = "bouncer";
      }
      if (ty) g.selectBuy(ty);
    }

    const my = g.units.filter(u => u.team === "player");
    const free = my.filter(u => !u.captureBiz || u.captureBiz.owner === "player");
    // Цели — по памяти игрока, а не по факту: с туманом войны бот обязан играть
    // в тех же потёмках, что и ИИ, иначе замер сложности превращается в замер читерства.
    const targets = g.businesses.filter(b => g.knownOwner("player", b) !== "player");
    if (!targets.length) continue;

    if (mode === "bot") {                       // слабая стратегия: всё в одну точку кучей
      if (free.length < 4) continue;
      const df = distFieldCached(g, h.x, h.y);
      let best = targets[0], bd = Infinity;
      targets.forEach(b => { const d = walkDist(g, df, b, h.x, h.y); if (d < bd) { bd = d; best = b; } });
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
    // Дома до двоих, и «дома» значит в зоне захвата штаба: ИИ ставит охрану так же,
    // иначе сравнение бота с ИИ нечестное. ХОТЯ БЫ ОДИН боец обязан остаться штурмовиком —
    // ровно то же условие, что у ИИ (pool.length>1). Без него бот со стартовыми двумя
    // бойцами загонял в охрану обоих и не захватывал вообще ничего: раньше это скрывал
    // мгновенный докуп вышибал, а с подорожавшим содержанием найм на старте закрыт.
    const hq = g.playerHQ();
    const hqSpots = hq ? g.captureSpots(hq) : [];
    const guards = hqSpots.length ? free.slice(0, Math.max(0, Math.min(2, free.length - 1))) : [];
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
      const df = distFieldCached(g, u.x, u.y);
      let best = null, bd = Infinity;
      targets.forEach(b => {
        if (load.get(b) >= perTarget) return;
        const d = walkDist(g, df, b, u.x, u.y); if (d < bd) { bd = d; best = b; }
      });
      if (!best) targets.forEach(b => {          // всё насыщено — просто к ближайшей
        const d = walkDist(g, df, b, u.x, u.y); if (d < bd) { bd = d; best = b; }
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
    inc: Math.round(g.fInc.player),                                          // доход/с к концу партии
    up: g.businesses.filter(b => b.owner === "player" && b.kind).length,     // своих улучшенных
    aiUp: g.businesses.filter(b => b.owner !== "player" && b.kind).length,   // улучшенных у соперников
    share: g.MARKET_KEYS.map(k => g.marketPct("player", k)).join("/"),      // доли по типам
  };
}

const mode = process.argv[2] || "mass";
const N = +(process.argv[3] || 20);
const aiCount = +(process.argv[4] || 2);        // число ИИ-противников (1..3)
const seedArg = process.argv[5] || "12345";     // база сида карт; `rnd` — случайные карты
const base = seedArg === "rnd" ? null : (+seedArg >>> 0) || 12345;
// Размер карты — такой же рычаг сложности, как число ИИ: меньше карта — меньше точек,
// а армия игрока упирается только в деньги. Сравнивать столбцы можно лишь при одном размере.
// Дефолт — маленькая карта: она дёшева по реальному времени. Цифры лесенки сложности
// в CLAUDE.md сняты на `large`, и сравнивать с ними можно только явный прогон на `large`.
const size = process.argv[6] || "small";
if (size === "large")
  console.log("⚠ large: одна партия — до минуты реального времени. " +
    "Это ручной замер пользователя, а не проверка «не сломано».");
// `nofog` снимает туман сразу у ВСЕХ сторон — иначе замер мерил бы не сложность, а читерство.
// Бот от этого играет заметно иначе: цели он берёт по knownOwner, а без тумана видит их все.
const fog = process.argv[7] === "nofog" ? false : undefined;
const rows = [];
for (let n = 0; n < N; n++)
  rows.push(play(loadGame(), mode, aiCount, base === null ? undefined : base + n * 7919, size, fog));
console.log(`${mode.toUpperCase()} — ${N} партий, ИИ: ${aiCount}, ` +
  `карта: ${size}${process.argv[6] ? "" : " (по умолчанию)"}, ` +
  `туман: ${fog === false ? "снят" : "есть"}, ` +
  `карты: ${base === null ? "случайные" : "сид " + base}`);
rows.forEach((r, i) => console.log(` #${i}`, JSON.stringify(r)));
const wins = rows.filter(r => r.win).map(r => r.sec);
console.log(` итог: побед ${wins.length}/${N}` +
  (wins.length ? `, время победы ${Math.min(...wins)}–${Math.max(...wins)} c` : ""));
