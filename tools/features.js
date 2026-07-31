// Регрессия на механики, которые баланс-сим не ловит: стартовый отряд, доход штаба,
// взятки за классы, урон снайпера по боевой стойке и правила зоны захвата.
//   node tools/features.js
const { loadGame, GAME } = require("./harness");

let fails = 0;
function ok(name, cond, extra) {
  if (!cond) { fails++; console.log(`  FAIL ${name}` + (extra ? ` — ${extra}` : "")); }
  else console.log(`  ok   ${name}`);
}

// ---------- стартовый отряд и доход штаба ----------
{
  const g = loadGame();
  g.reset(3);
  g.factions.forEach(f => {
    const mine = g.units.filter(u => u.team === f);
    const by = t => mine.filter(u => u.type === t).length;
    ok(`${f}: ровно 1 вышибала + 1 стрелок`,
      mine.length === 2 && by("bouncer") === 1 && by("shooter") === 1,
      `всего ${mine.length}, вышибал ${by("bouncer")}, стрелков ${by("shooter")}`);
    const hq = g.factionHQ(f);
    ok(`${f}: штаб даёт $10/с`, hq && hq.income === 10, hq && `income=${hq.income}`);
    // на старте у фракции нет ничего, кроме штаба: все прочие точки надо брать самому
    const own = g.businesses.filter(b => b.owner === f);
    ok(`${f}: владеет только штабом`, own.length === 1 && own[0] === hq,
      `точек ${own.length}: ` + own.map(b => b.name + (b.hq ? " (штаб)" : "")).join(", "));
  });
}

// ---------- взятки: изначально открыт только вышибала ----------
{
  const g = loadGame();
  g.reset(1);
  // по TYPES, а не поимённо: перечень классов молча пропускал бы новый
  ok("открыт только вышибала", g.unlocks.player.bouncer === true &&
    Object.keys(g.TYPES).every(t => t === "bouncer" || !g.unlocks.player[t]),
    "открыто: " + Object.keys(g.unlocks.player).filter(t => g.unlocks.player[t]).join(", "));

  const n0 = g.units.filter(u => u.team === "player").length;
  g.money = 5000;
  g.selectBuy("shooter");                      // первый клик — взятка, бойца ещё нет
  const afterBribe = g.units.filter(u => u.team === "player").length;
  ok("первый найм закрытого класса тратится на взятку",
    g.unlocks.player.shooter === true && afterBribe === n0,
    `бойцов было ${n0}, стало ${afterBribe}`);
  ok("взятка списала $" + g.TYPES.shooter.bribe, Math.round(g.money) === 5000 - g.TYPES.shooter.bribe,
    `осталось ${Math.round(g.money)}`);

  g.selectBuy("shooter");                      // второй — уже обычный наём
  ok("после взятки класс нанимается",
    g.units.filter(u => u.team === "player" && u.type === "shooter").length === 2);

  // не хватает на взятку — класс остаётся закрытым
  g.money = 10;
  g.selectBuy("sniper");
  ok("без денег взятка не проходит", !g.unlocks.player.sniper);

  // панель должна честно показывать, что именно спишется по клику
  ok("панель: у открытого класса цена найма",
    g.els.costShooter.textContent === "$" + g.TYPES.shooter.cost, g.els.costShooter.textContent);
  ok("панель: у закрытого класса цена взятки",
    g.els.costSniper.textContent === "взятка $" + g.TYPES.sniper.bribe, g.els.costSniper.textContent);

  // 4-й класс проходит те же ворота. Идёт ПОСЛЕ проверок панели: поднятая касса
  // сбила бы проверку «без денег взятка не проходит».
  g.money = 5000;
  g.selectBuy("undertaker");
  ok("гробовщик открывается взяткой и бойца ещё не даёт",
    g.unlocks.player.undertaker === true &&
    !g.units.some(u => u.team === "player" && u.type === "undertaker") &&
    Math.round(g.money) === 5000 - g.TYPES.undertaker.bribe, `осталось ${Math.round(g.money)}`);
  g.selectBuy("undertaker");
  ok("после взятки гробовщик нанимается",
    g.units.filter(u => u.team === "player" && u.type === "undertaker").length === 1);
  ok("панель: у гробовщика своя цена найма",
    g.els.costUndertaker.textContent === "$" + g.TYPES.undertaker.cost, g.els.costUndertaker.textContent);

  // Заглушка getElementById заводит элемент, только когда его СПРОСИЛИ: запись в els
  // и есть доказательство, что класс проведён в панель, а не только в TYPES.
  const cap = t => t[0].toUpperCase() + t.slice(1);
  ok("у каждого класса своя кнопка в панели", Object.keys(g.TYPES).every(t => g.els["buy" + cap(t)]),
    "нет кнопки: " + Object.keys(g.TYPES).filter(t => !g.els["buy" + cap(t)]).join(", "));
  ok("новый класс не забыт в resetUnlocks", g.factions.every(f =>
    Object.keys(g.TYPES).every(t => typeof g.unlocks[f][t] === "boolean")));
}

// ---------- гробовщик: томпсон, самый плотный огонь и цена этой плотности ----------
{
  const g = loadGame();
  g.reset(1);
  const U = g.TYPES.undertaker, S = g.TYPES.sniper, Sh = g.TYPES.shooter;
  const all = Object.keys(g.TYPES);

  ok("гробовщик стреляет чаще всех", all.every(t => g.TYPES[t].rate >= U.rate) && U.rate < Sh.rate / 2,
    `rate=${U.rate}, у стрелка ${Sh.rate}`);
  ok("снайпер стреляет реже всех", all.every(t => g.TYPES[t].rate <= S.rate), `rate=${S.rate}`);
  ok("гробовщик бьёт дальше стрелка, но не дальше снайпера",
    U.range > Sh.range && U.range < S.range, `${Sh.range} < ${U.range} < ${S.range}`);
  ok("здоровья больше, чем у стрелка", U.hp > Sh.hp, `${U.hp} против ${Sh.hp}`);
  ok("плотность огня оплачена: самый дорогой класс по найму, взятке и содержанию",
    all.every(t => t === "undertaker" ||
      (g.TYPES[t].cost < U.cost && g.TYPES[t].bribe < U.bribe && g.TYPES[t].up < U.up)),
    `наём $${U.cost}, взятка $${U.bribe}, содержание $${U.up}/с`);
  ok("за секунду боя выдаёт заметно больше стрелка",
    U.dmg / U.rate > Sh.dmg / Sh.rate * 1.5,
    `${(U.dmg / U.rate).toFixed(1)} против ${(Sh.dmg / Sh.rate).toFixed(1)} урона/с`);

  const hq = g.playerHQ(), sp = g.captureSpots(hq)[0];
  g.spawnUnit("sniper", sp.x, sp.y, "player");
  g.spawnUnit("undertaker", sp.x + 30, sp.y, "ai1");
  const sniper = g.units[g.units.length - 2], mark = g.units[g.units.length - 1];

  // Томпсон обязан идти по ОБЩЕЙ пулевой ветке fire: своей ветки у него нет,
  // и появление такой ветки — ровно то, что этот тест должен поймать.
  mark.combat = 0;
  g.bullets.length = 0;
  g.fire(mark, sniper);
  ok("томпсон бьёт пулей, без снайперской скидки и не в упор",
    g.bullets.length === 1 && g.bullets[0].dmg === U.dmg, `пуль ${g.bullets.length}`);
  ok("свой выстрел из томпсона ставит гробовщика в стойку", mark.combat > 0);

  // Контригра ровно одна: снайпер берёт гробовщика только на подходе.
  // Урон снайпера считается на самом выстреле, поэтому меряем от maxhp, а не от hp.
  mark.hp = mark.maxhp;
  g.bullets.length = 0;
  g.fire(sniper, mark);
  ok("ввязавшегося в бой гробовщика снайпер уже не снимает",
    g.bullets[0] && g.bullets[0].dmg < mark.maxhp,
    g.bullets[0] && `урон ${g.bullets[0].dmg} при ${mark.maxhp} HP`);
  // ...но и в стойке он не бессмертен: SNIPER_ENGAGED выведен ровно из этих 120 HP.
  g.fire(sniper, mark);
  ok("со второго выстрела снайпер снимает гробовщика и в стойке",
    mark.hp <= 0, `${mark.hp} HP после двух выстрелов`);

  mark.hp = mark.maxhp;
  mark.combat = 0;
  g.bullets.length = 0;
  g.fire(sniper, mark);
  ok("зазевавшегося гробовщика снайпер снимает с одного выстрела",
    g.bullets[0] && g.bullets[0].dmg >= mark.maxhp,
    g.bullets[0] && `урон ${g.bullets[0].dmg} при ${mark.maxhp} HP`);
}

// ---------- ИИ открывает классы теми же воротами, только платит территорией ----------
{
  const g = loadGame();
  g.reset(1);
  const B = g.AI_BRIBE;
  ok("у каждого платного класса есть порог для ИИ", Object.keys(g.TYPES)
    .every(t => (g.TYPES[t].bribe === 0) === (B[t] === undefined)), JSON.stringify(B));
  ok("чем дороже взятка игрока, тем позже класс открывается у ИИ",
    Object.keys(B).sort((a, b) => g.TYPES[a].bribe - g.TYPES[b].bribe)
      .every((t, i, a) => !i || B[a[i - 1]] < B[t]), JSON.stringify(B));
  ok("пороги достижимы на карте", Object.keys(B).every(t => B[t] <= g.businesses.length),
    `${g.businesses.length} точек всего`);
}

// ---------- снайпер: с одного выстрела, но не по бойцу в стойке ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ(), sp = g.captureSpots(hq)[0];
  g.spawnUnit("sniper", sp.x, sp.y, "player");
  g.spawnUnit("bouncer", sp.x + 30, sp.y, "ai1");
  const all = g.units;
  const sniper = all[all.length - 2], victim = all[all.length - 1];

  // урон снайпера считается на выстреле и едет в пуле — её и смотрим
  victim.combat = 0;
  g.bullets.length = 0;
  g.fire(sniper, victim);
  const calm = g.bullets[0];
  ok("снайпер снимает вышибалу с одного выстрела", calm && calm.dmg >= victim.maxhp,
    calm && `урон ${calm.dmg} при ${victim.maxhp} HP`);

  victim.combat = 2;                            // цель сама ведёт бой
  g.bullets.length = 0;
  g.fire(sniper, victim);
  const engaged = g.bullets[0];
  ok("по бойцу в стойке урон снайпера резко падает",
    engaged && engaged.dmg > 0 && engaged.dmg < calm.dmg * 0.4,
    engaged && `урон ${engaged.dmg} против ${calm.dmg}`);
  // Скидка выведена из самого живучего класса: даже гробовщика в стойке снайпер
  // обязан снимать ровно за два выстрела — не за один и не за четыре.
  ok("двух выстрелов хватает на любого бойца в стойке",
    engaged.dmg * 2 >= g.TYPES.undertaker.hp && engaged.dmg < g.TYPES.undertaker.hp,
    `${engaged.dmg} x2 против ${g.TYPES.undertaker.hp} HP гробовщика`);

  ok("снайпер стреляет редко", g.TYPES.sniper.rate >= 3 &&
    g.TYPES.sniper.rate > g.TYPES.shooter.rate * 5, `rate=${g.TYPES.sniper.rate}`);

  ok("свой выстрел ставит бойца в боевую стойку", sniper.combat > 0);
}

// ---------- снайпер попадает В МОМЕНТ ВЫСТРЕЛА, а не когда долетит ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ(), sp = g.captureSpots(hq)[0];
  g.units.length = 0;                            // чужие бойцы в этой сцене только мешают
  g.spawnUnit("sniper", sp.x, sp.y, "player");
  g.spawnUnit("bouncer", sp.x + 8, sp.y, "ai1");
  const sniper = g.units[0], victim = g.units[1];

  victim.combat = 0;
  g.bullets.length = 0;
  g.fire(sniper, victim);
  ok("урон снайпера ложится сразу на выстреле", victim.hp <= 0,
    `${victim.hp} HP сразу после fire`);
  // Пуля остаётся только как трассер: без target она не может ударить второй раз,
  // и ушедшую вбок цель (через мост, например) она уже не «промахивает».
  ok("снайперская пуля — трассер, цель второй раз не бьёт",
    g.bullets.length === 1 && g.bullets[0].target === null && g.bullets[0].dmg > 0);

  // У остальных классов пуля по-прежнему летит и ведёт цель — своей ветки они не получили
  g.spawnUnit("shooter", sp.x, sp.y, "player");
  const shooter = g.units[g.units.length - 1];
  victim.hp = victim.maxhp;
  g.bullets.length = 0;
  g.fire(shooter, victim);
  ok("у остальных пуля летит и урон считается на попадании",
    g.bullets[0] && g.bullets[0].target === victim && victim.hp === victim.maxhp,
    `${victim.hp} HP`);
}

// ---------- прицеливание: секунда до выстрела, и сбивается вместе с целью ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ(), sp = g.captureSpots(hq)[0];
  const need = g.TYPES.sniper.aim;

  ok("снайперу задано время прицеливания", need >= 1, `aim=${need}`);
  ok("остальным классам целиться не надо",
    Object.keys(g.TYPES).every(t => t === "sniper" || !g.TYPES[t].aim));

  g.units.length = 0;
  g.spawnUnit("sniper", sp.x, sp.y, "player");
  g.spawnUnit("bouncer", sp.x + 6, sp.y, "ai1");
  const sniper = g.units[0], victim = g.units[1];

  // aim задан в ИГРОВЫХ секундах, как rate и COMBAT_TIME, а update принимает реальные
  let t = 0;
  const step = 0.05 * g.GAME_SPEED;
  while (t < need - 0.15) { g.update(0.05); t += step; }
  ok("пока целится — не стреляет",
    victim.hp === victim.maxhp && sniper.aimT > 0,
    `${victim.hp} HP, прицел ${sniper.aimT.toFixed(2)}с из ${need}с`);
  ok("целящийся боец уже в боевой стойке", sniper.combat > 0,
    `стойка ${sniper.combat.toFixed(2)}с, а выстрела ещё не было`);

  while (t < need + 0.2) { g.update(0.05); t += step; }
  // Насмерть тут не проверяем: вышибала успевает огрызнуться и встаёт в стойку,
  // а по бойцу в стойке снайпер бьёт вполсилы — это соседняя механика, не эта.
  ok("додержав цель — стреляет", victim.hp < victim.maxhp, `${victim.hp} HP на ${t.toFixed(2)}с`);

  // Прицел копится и во время перезарядки: секунда стоит только ПЕРВЫЙ выстрел по цели,
  // дальше цикл держится на rate. Иначе класс тихо терял бы четверть урона в секунду.
  sniper.hp = sniper.maxhp = 9000;               // сцена про темп огня, а не про размен
  victim.hp = victim.maxhp = 9000;
  const gap = [];
  let last = victim.hp, t2 = 0, lowest = 9;
  while (gap.length < 2 && t2 < 14) {
    g.update(0.05); t2 += step;
    lowest = Math.min(lowest, sniper.combat);
    if (victim.hp < last) { gap.push(t2); last = victim.hp; }
  }
  ok("второй выстрел идёт по перезарядке, без новой секунды прицела",
    gap.length === 2 && gap[1] - gap[0] < g.TYPES.sniper.rate + need * 0.5,
    gap.length === 2 && `между выстрелами ${(gap[1] - gap[0]).toFixed(2)}с при rate ${g.TYPES.sniper.rate}`);
  // rate 3.6 больше COMBAT_TIME 2.2: пока стойку взводил только свой выстрел,
  // снайпер между выстрелами выпадал из неё и ловил чужую пулю в упор, ведя бой.
  ok("стойка не проседает между выстрелами", lowest > 0,
    `минимум стойки за цикл ${lowest.toFixed(2)}с при rate ${g.TYPES.sniper.rate} и COMBAT_TIME ${g.COMBAT_TIME}`);

  // Цель ушла — прицел не копится «в кармане»: следующая начинается с нуля.
  sniper.aimT = 0.9; sniper.aimTgt = victim;
  g.aimOff(sniper);
  ok("прицел сбивается, когда цель потеряна", sniper.aimT === 0 && sniper.aimTgt === null);
}

// ---------- зона захвата: узкий крест вплотную, без диагоналей ----------
{
  const g = loadGame();
  g.reset(1);
  const T = g.TILE;
  const b = g.businesses.find(x => x.owner === "neutral");
  const at = (dx, dy) => ({ x: b.x + dx, y: b.y + dy });

  ok("точки захвата только по четырём граням", g.captureSpots(b).every(s =>
    (Math.abs(s.x - b.x) < 1 && Math.abs(Math.abs(s.y - b.y) - T) < 1) ||
    (Math.abs(s.y - b.y) < 1 && Math.abs(Math.abs(s.x - b.x) - T) < 1)));
  ok("хотя бы одна точка захвата есть", g.captureSpots(b).length >= 1);

  ok("в лоб к грани — зона", g.captureSpots(b).every(s => g.inCapZone(b, at(s.x - b.x, s.y - b.y))));
  ok("по диагонали — не зона", !g.inCapZone(b, at(T, T)) && !g.inCapZone(b, at(-T, T)));
  ok("наискось от грани — не зона", !g.inCapZone(b, at(T * 0.6, T)));
  ok("издалека — не зона", !g.inCapZone(b, at(0, T * 1.6)));
}

// ---------- клик точно по заведению строит маршрут к точке захвата ----------
{
  const g = loadGame();
  g.reset(1);
  const b = g.businesses.find(x => x.owner === "neutral" && g.captureSpots(x).length);
  const u = g.units.find(x => x.team === "player");
  g.selected.clear(); g.selected.add(u.id);
  g.commandTo({ x: b.x, y: b.y });              // ПКМ ровно по заведению

  ok("клик по заведению даёт приказ на захват", u.order === "capture" && u.captureBiz === b);
  ok("маршрут ведёт в зону захвата, а не в само заведение",
    g.inCapZone(b, { x: u.tx, y: u.ty }), `цель (${Math.round(u.tx)},${Math.round(u.ty)})`);
  ok("конечная точка проходима",
    g.passable(Math.floor(u.tx / g.TILE), Math.floor(u.ty / g.TILE)));
  ok("маршрут построен", Array.isArray(u.path) ? u.path.length > 0 : u.path === null);
}

// ---------- захват тянет один сильнейший, скорость от силы ----------
{
  // одинаковый мир, разные захватчики: время до 100% должно отличаться в pow раз
  function grabTime(types) {
    const g = loadGame();
    g.reset(1);
    const b = g.businesses.find(x => x.owner === "neutral" && g.captureSpots(x).length);
    const s = g.captureSpots(b)[0];
    types.forEach((t, i) => g.spawnUnit(t, s.x + i * 2, s.y, "player"));
    let t = 0;
    while (b.owner !== "player" && t < 60) { g.captureBusinesses(0.05); t += 0.05; }
    return t;
  }
  const one = grabTime(["bouncer"]);
  const five = grabTime(["bouncer", "bouncer", "bouncer", "bouncer", "bouncer"]);
  const sniper = grabTime(["sniper"]);
  ok("толпа вышибал захватывает не быстрее одного", Math.abs(one - five) < 0.2,
    `1 боец ${one.toFixed(1)}с, 5 бойцов ${five.toFixed(1)}с`);
  ok("сильный гангстер захватывает быстрее слабого", sniper < one * 0.7,
    `вышибала ${one.toFixed(1)}с, снайпер ${sniper.toFixed(1)}с`);
}

// ---------- туман войны: обзор режется домами, память о чужих точках ----------
{
  const g = loadGame();
  g.reset(2);
  const T = g.TILE, COLS = g.COLS, ROWS = g.ROWS;
  const seen = f => { let n = 0; const v = g.vis[f]; for (let i = 0; i < v.length; i++) n += v[i]; return n; };

  ok("sight >= range у каждого класса", Object.keys(g.TYPES).every(t => g.TYPES[t].sight >= g.TYPES[t].range),
    Object.keys(g.TYPES).map(t => `${t} ${g.TYPES[t].sight}/${g.TYPES[t].range}`).join(", "));

  const u = g.units.find(x => x.team === "player");
  ok("свой боец видит клетку под собой", g.canSee("player", u.x, u.y));
  // на карте 40x30 старт видно 2..5% клеток; порог 0.15 — с запасом, но уже с зубами
  ok("обзор — не вся карта", seen("player") < COLS * ROWS * 0.15,
    `видно ${seen("player")} из ${COLS * ROWS} клеток`);

  // Дом в глубине квартала лучом не берётся: видна только та стена, к которой примыкает
  // просматриваемая ходибельная клетка. Условие — ровно правило второго прохода visFrom:
  // не «непроходим со всех сторон» (вода тоже непроходима, но сквозь неё видно),
  // а «нет ни одного ходибельного соседа».
  const uc = Math.floor(u.x / T), ur = Math.floor(u.y / T);
  let deep = null;
  for (let dr = -3; dr <= 3 && !deep; dr++) for (let dc = -3; dc <= 3 && !deep; dc++) {
    const c = uc + dc, r = ur + dr;
    if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1) continue;
    if (!g.opaqueT(g.grid[r][c])) continue;
    if (!g.nextToWalk(c, r)) deep = [c, r];
  }
  ok("дом без выхода на дорогу не виден", !deep || !g.canSee("player", deep[0] * T + T / 2, deep[1] * T + T / 2),
    deep ? `клетка ${deep}` : "такого дома рядом не нашлось");

  // Своя точка — это свои люди на месте: обзор не хуже живого стрелка и во все стороны,
  // то есть со всех подходов, а не с одного случайного соседа непроходимой клетки.
  ok("заведение видит не хуже стрелка", g.SIGHT_BIZ >= g.TYPES.shooter.sight && g.SIGHT_HQ >= g.SIGHT_BIZ,
    `точка ${g.SIGHT_BIZ}, штаб ${g.SIGHT_HQ}, стрелок ${g.TYPES.shooter.sight}`);
  // чужие бойцы на старте — за туманом
  const far = g.units.filter(x => x.team !== "player");
  ok("чужие бойцы на старте не видны", far.every(p => !g.canSee("player", p.x, p.y)),
    `видно ${far.filter(p => g.canSee("player", p.x, p.y)).length} из ${far.length}`);

  // На старте у фракции только штаб, поэтому чужую не-штабную точку заводим руками:
  // ИИ забрал ближайшую к себе, а игрок этого не видел — ровно тот случай, что проверяем.
  const aiHQ = g.factionHQ("ai1");
  let grabbed = null, gd = 1e9;
  g.businesses.forEach(b => {
    if (b.owner !== "neutral" || b.hq) return;
    const d = Math.hypot(b.x - aiHQ.x, b.y - aiHQ.y);
    if (d < gd) { gd = d; grabbed = b; }
  });
  if (grabbed) grabbed.owner = "ai1";
  g.updateVision(1);                               // память обновляется только по видимому

  // чужие точки считаются нейтральными, пока их не разведали; штабы — исключение
  const enemyBiz = g.businesses.filter(b => b.owner !== "player" && b.owner !== "neutral" && !b.hq);
  ok("неразведанная чужая точка считается нейтральной",
    enemyBiz.length > 0 && enemyBiz.every(b => g.knownOwner("player", b) === "neutral"),
    `чужих не-штабов ${enemyBiz.length}`);
  ok("чужой штаб известен всем — цель партии не прячется",
    g.factions.every(f => g.knownOwner("player", g.factionHQ(f)) === f));

  // подвели бойца вплотную — владелец проявился
  const spy = enemyBiz[0];
  if (spy) {
    const s = g.captureSpots(spy)[0] || { x: spy.x, y: spy.y };
    g.spawnUnit("bouncer", s.x, s.y, "player");
    g.updateVision(1);
    ok("разведанная точка показывает настоящего владельца",
      g.knownOwner("player", spy) === spy.owner, `память ${g.knownOwner("player", spy)}, факт ${spy.owner}`);
  }
}

// ---------- тип заведения фогнут наравне с владельцем ----------
// Во что точку превратили — видно только с улицы. Пока она в тумане, на плитке
// держится последний РАЗВЕДАННЫЙ тип, а не сегодняшний.
{
  const g = loadGame();
  g.reset(2, 1007);
  const hq = g.playerHQ();
  const far = g.businesses.filter(b => !b.hq
    && Math.hypot(b.x - hq.x, b.y - hq.y) > 700
    && g.units.every(u => Math.hypot(u.x - b.x, u.y - b.y) > 700)
    && g.captureSpots(b).length > 0);
  const b = far[0];
  if (!b) { ok("нашлась дальняя точка для проверки тумана типа", false); }
  else {
    b.owner = "ai1"; b.kind = "bar";
    g.updateVision(1);
    ok("неразведанное заведение типа не выдаёт", g.knownKind("player", b) === null,
      `видно ${g.knownKind("player", b)}`);
    ok("на плитке неразведанной точки базовый доход",
      g.bizTag(b, g.knownKind("player", b)) === "$" + b.income,
      `на плитке ${g.bizTag(b, g.knownKind("player", b))}`);

    // подвели бойца вплотную — тип проявился вместе с владельцем
    const s = g.captureSpots(b)[0];
    g.spawnUnit("bouncer", s.x, s.y, "player");
    const scout = g.units[g.units.length - 1];
    g.updateVision(1);
    ok("разведанная точка показывает настоящий тип", g.knownKind("player", b) === "bar");
    ok("на плитке разведанного бара его цена",
      g.bizTag(b, g.knownKind("player", b)) === "$" + g.UPGRADES.bar.X);

    // боец ушёл, а хозяин тем временем перестроил точку — игрок помнит бар
    scout.hp = 0;
    b.kind = "casino";
    g.updateVision(1);
    ok("за туманом держится последний разведанный тип", g.knownKind("player", b) === "bar",
      `помнит ${g.knownKind("player", b)}, факт ${b.kind}`);
    ok("экономика считает по факту, а не по памяти игрока",
      g.bizBaseIncome(b) === g.UPGRADES.casino.X);

    // снос за туманом тоже незаметен
    b.kind = null;
    g.updateVision(1);
    ok("снос за туманом не виден", g.knownKind("player", b) === "bar");

    // без тумана память равна факту сразу у всех
    g.reset(2, 1007, undefined, false);
    const nb = g.businesses.find(x => !x.hq);
    nb.owner = "ai1"; nb.kind = "casino";
    g.updateVision(1);
    ok("без тумана тип чужой точки известен", g.knownKind("player", nb) === "casino");
  }
}

// ---------- своя точка светит во все стороны, а не в одну сторону ----------
// Заведение стоит в непроходимой клетке: обзор из его центра ушёл бы в ОДИН соседний
// проходимый тайл (nearestPassable), и дальняя грань дома осталась бы в тумане.
// Требование — видны все подходы к своей точке, те же captureSpots, что и у захвата.
{
  const g = loadGame();
  g.reset(2, 1007);                                 // сид: карта воспроизводима, подходы известны
  const far = g.businesses.filter(b => !b.hq && g.captureSpots(b).length >= 2
    && g.units.every(u => Math.hypot(u.x - b.x, u.y - b.y) > 600));
  const b = far[0];
  const seen = () => { let n = 0; const v = g.vis.player; for (let i = 0; i < v.length; i++) n += v[i]; return n; };
  if (!b) { ok("нашлась точка с двумя подходами вдали от бойцов", false); }
  else {
    const sp = g.captureSpots(b);
    g.updateVision(1);
    const base = seen();
    ok("ничья точка обзора не даёт", sp.every(s => !g.canSee("player", s.x, s.y)));

    b.owner = "player";                             // как будто её только что захватили
    g.updateVision(1);
    const withBiz = seen() - base;
    const dark = sp.filter(s => !g.canSee("player", s.x, s.y));
    ok("свою точку видно со всех подходов", dark.length === 0,
      `подходов ${sp.length}, тёмных ${dark.length}`);

    // «не хуже стрелка»: точка открывает не меньше клеток, чем живой стрелок,
    // поставленный на один из её же подходов
    b.owner = "neutral";
    g.updateVision(1);
    g.spawnUnit("shooter", sp[0].x, sp[0].y, "player");
    g.updateVision(1);
    const withMan = seen() - base;
    ok("точка видит не меньше стрелка на её пороге", withBiz >= withMan,
      `точка открыла ${withBiz} клеток, стрелок ${withMan}`);
  }
}

// ---------- туман сбрасывается вместе с картой ----------
{
  const g = loadGame();
  const share = () => { const v = g.vis.player; let n = 0; for (let i = 0; i < v.length; i++) n += v[i]; return n / v.length; };
  g.reset(2);
  const first = share();
  g.reset(2);                                    // новая карта — кэш лучей обязан пересчитаться
  ok("после новой партии обзор снова узкий", share() < 0.15,
    `было ${(first * 100).toFixed(1)}%, стало ${(share() * 100).toFixed(1)}%`);
  ok("память о точках пересоздана под новую карту",
    g.businesses.every(b => b.memo && g.factions.every(f => b.memo[f])));
}

// ---------- рынок заведений: пол в 10 точек, доля в целых процентах ----------
{
  const g = loadGame();
  g.reset(2);
  const plain = g.businesses.filter(b => !b.hq);
  ok("базовый доход остался 4..9", plain.every(b => b.income >= 4 && b.income <= 9));
  ok("на старте никто не улучшен", g.businesses.every(b => b.kind === null));
  // Инвариант держится на ДОХОДНЫХ типах. Тренировочный центр из них выведен пометкой
  // rally, и списки не перечисляются руками — иначе они разъедутся при новом типе.
  ok("улучшение всегда выгоднее базы: X > 9 у всех доходных типов",
    g.MARKET_KEYS.length > 0 && g.MARKET_KEYS.every(k => g.UPGRADES[k].X > 9),
    g.MARKET_KEYS.map(k => `${k} X=${g.UPGRADES[k].X}`).join(", "));
  ok("рыночные типы выведены из пометки, а не перечислены",
    g.MARKET_KEYS.join() === g.UP_KEYS.filter(k => !g.UPGRADES[k].rally).join());
  ok("пустой рынок меряется полом 10", g.marketSize("bar") === 10 && g.marketPct("player", "bar") === 0);

  // 5 своих баров из 12 построенных: пол больше не действует, доля округляется до целых
  const pool = plain.slice(0, 12);
  pool.forEach((b, i) => { b.kind = "bar"; b.owner = i < 5 ? "player" : "ai1"; });
  ok("рынок больше пола меряется числом заведений", g.marketSize("bar") === 12);
  ok("доля округляется до целых процентов", g.marketPct("player", "bar") === 42,
    `доля ${g.marketPct("player", "bar")}%`);                       // 5/12 = 41.67
  ok("доход бара по формуле X*(1+Y*доля)", g.bizIncomeOf("player", pool[0]) === 44,
    `${g.bizIncomeOf("player", pool[0])} вместо 44`);               // 24*(1+2*0.42)
  pool[0].kind = "fixer";
  ok("решение проблем не зависит от рынка", g.bizIncomeOf("player", pool[0]) === g.UPGRADES.fixer.X);
  pool[0].kind = "bar";
  // доля считается по факту, а не по памяти: неразведанная чужая точка всё равно в рынке
  const dark = pool.find(b => b.owner === "ai1" && g.knownOwner("player", b) !== "ai1");
  ok("рынок считается по факту, не по туману", !!dark && g.marketSize("bar") === 12);
  // на плитке — цена «как в прайсе»: цифра, зависящая от живой доли, текла бы сквозь туман
  ok("на плитке доход без доли рынка", g.bizBaseIncome(pool[0]) === g.UPGRADES.bar.X &&
    g.bizIncome(pool[0]) > g.bizBaseIncome(pool[0]),
    `плитка ${g.bizBaseIncome(pool[0])}, по факту ${g.bizIncome(pool[0])}`);
  const shown = g.bizBaseIncome(pool[0]);
  pool[0].owner = "ai1";                                            // точку увели
  ok("цифра на плитке не меняется при смене владельца", g.bizBaseIncome(pool[0]) === shown);
  pool[0].owner = "player";
  const plainBiz = g.businesses.find(b => !b.hq && !b.kind);
  ok("у неулучшенной точки на плитке базовый доход", g.bizBaseIncome(plainBiz) === plainBiz.income);
}

// ---------- ворота улучшения: своя точка, не штаб, один раз, за деньги ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ();
  // улучшать нечего, пока не захватишь: на старте у игрока один штаб
  const mine = g.businesses.find(b => b.owner === "neutral" && !b.hq);
  if (mine) mine.owner = "player";
  const foreign = g.businesses.find(b => b.owner !== "player");
  g.money = 5000;
  ok("штаб не улучшается", !g.canUpgrade("player", hq) && !g.buyUpgrade("player", hq, "bar") && hq.kind === null);
  ok("штаб по-прежнему даёт $10/с", hq.income === 10 && g.bizIncomeOf("player", hq) === 10);
  ok("чужую точку не улучшить", !g.buyUpgrade("player", foreign, "bar") && foreign.kind === null);
  ok("покупка списывает ровно цену", g.buyUpgrade("player", mine, "casino") &&
    mine.kind === "casino" && Math.round(g.money) === 5000 - g.UPGRADES.casino.cost,
    `kind=${mine.kind}, деньги ${Math.round(g.money)}`);
  const after = g.money;
  ok("улучшение необратимо", !g.buyUpgrade("player", mine, "bar") && mine.kind === "casino" && g.money === after);
  const two = g.businesses.find(b => b.owner === "neutral" && !b.hq && !b.kind);
  if (two) two.owner = "player";
  g.money = 50;
  ok("без денег улучшения нет", !two || (!g.buyUpgrade("player", two, "strip") && two.kind === null));
}

// ---------- снос: единственный способ сменить тип, и он ничего не возвращает ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ();
  // на старте у игрока один штаб, поэтому точку под снос сперва забираем
  const mine = g.businesses.find(b => b.owner === "neutral" && !b.hq);
  mine.owner = "player";
  const foreign = g.businesses.find(b => b.owner === "neutral" && !b.hq && b !== mine);
  foreign.owner = "ai1";                     // именно чужое, а не ничьё
  g.money = 5000;
  ok("простую точку сносить нечего", !g.canDemolish("player", mine) && !g.demolish("player", mine));
  g.buyUpgrade("player", mine, "casino");
  foreign.kind = "bar";
  ok("штаб не сносится", !g.canDemolish("player", hq) && !g.demolish("player", hq));
  ok("чужое заведение не снести", !g.demolish("player", foreign) && foreign.kind === "bar");
  const before = g.money;
  ok("снос возвращает точку в простое состояние",
    g.demolish("player", mine) && mine.kind === null && g.bizIncome(mine) === mine.income,
    `kind=${mine.kind}, доход ${g.bizIncome(mine)} при базовом ${mine.income}`);
  ok("за снос деньги не возвращаются", g.money === before, `было ${before}, стало ${g.money}`);
  ok("после сноса точку можно улучшить заново за полную цену",
    g.buyUpgrade("player", mine, "bar") && mine.kind === "bar" &&
    Math.round(g.money) === Math.round(before) - g.UPGRADES.bar.cost,
    `kind=${mine.kind}, касса ${Math.round(g.money)}`);
  ok("улучшение поверх улучшения по-прежнему запрещено — только через снос",
    !g.buyUpgrade("player", mine, "strip") && mine.kind === "bar");
}

// ---------- экономика: свой кошелёк у каждой фракции, счёт не уходит в минус ----------
{
  const g = loadGame();
  g.reset(1);
  g.units.length = 0;                                       // содержание никого не ест
  g.businesses.forEach(b => { if (b.owner === "player" && !b.hq) b.owner = "neutral"; });
  const hq = g.playerHQ();
  g.money = 0;
  g.tickEconomy(1);
  ok("один штаб даёт ровно $10 за секунду", Math.round(g.money) === 10, `$${g.money}`);
  ok("у ИИ есть свой кошелёк и свой доход", g.funds.ai1 > 0 && g.fInc.ai1 > 0,
    `funds ${Math.round(g.funds.ai1)}, доход ${g.fInc.ai1}`);
  g.money = 0;
  g.spawnUnit("sniper", hq.x, hq.y, "player");
  for (let i = 0; i < 40; i++) g.tickEconomy(0.5);
  ok("счёт не уходит в минус", g.money >= 0, `$${g.money}`);
  // доход растёт с долей рынка: тот же бизнес при своей монополии дороже
  const b = g.businesses.find(x => !x.hq);
  b.owner = "player"; b.kind = "bar";
  const one = g.bizIncome(b);
  g.businesses.filter(x => !x.hq && !x.kind).slice(0, 9).forEach(x => { x.owner = "player"; x.kind = "bar"; });
  ok("доля рынка поднимает доход бара", g.bizIncome(b) > one,
    `1 бар ${one}, 10 баров ${g.bizIncome(b)}`);
}

// ---------- цены классов выведены из содержания: минута upkeep = цена найма ----------
// Правило важнее конкретных чисел: армия — это расход, а не имущество, и именно оно
// не даёт «накопить кучу и разбить всё». Проверяем по TYPES, а не поимённо.
{
  const g = loadGame();
  g.reset(1);
  const all = Object.keys(g.TYPES);
  ok("минута содержания стоит ровно как найм",
    all.every(t => g.TYPES[t].cost === g.TYPES[t].up * 60),
    all.map(t => `${t}: $${g.TYPES[t].cost} против $${g.TYPES[t].up}*60`).join(", "));
  ok("взятка — цена найма, у гробовщика двойная",
    g.TYPES.bouncer.bribe === 0 &&
    ["shooter", "sniper"].every(t => g.TYPES[t].bribe === g.TYPES[t].cost) &&
    g.TYPES.undertaker.bribe === g.TYPES.undertaker.cost * 2,
    all.map(t => `${t}: взятка $${g.TYPES[t].bribe} при найме $${g.TYPES[t].cost}`).join(", "));
  // Заведение обязано окупать бойцов: иначе экономика не догоняет содержание
  // и партия вырождается в два маленьких отряда у своих штабов.
  ok("лучшее улучшение содержит хотя бы стрелка",
    Math.max(...g.MARKET_KEYS.map(k => g.UPGRADES[k].X)) > g.TYPES.shooter.up,
    g.MARKET_KEYS.map(k => `${k} X=${g.UPGRADES[k].X}`).join(", ") + `, стрелок $${g.TYPES.shooter.up}/с`);
}

// ---------- вышибала — инструмент захвата, а не боец ----------
// Замысел держится не словами, а числами: он обязан проигрывать за те же деньги.
{
  const g = loadGame();
  g.reset(1);
  const T = g.TYPES;
  const dps = t => T[t].dmg / T[t].rate;
  // Боевая ценность по Ланчестеру: урон в секунду на живучесть. За доллар и за доллар
  // содержания вышибала обязан быть хуже стрелка — иначе «много вышибал» станет выигрышем.
  const power = t => dps(t) * T[t].hp;
  ok("здоровья у вышибалы как у стрелка", T.bouncer.hp === T.shooter.hp,
    `${T.bouncer.hp} против ${T.shooter.hp}`);
  ok("урон вышибалы заметно ниже, чем у стрелка", dps("bouncer") < dps("shooter") / 2,
    `${dps("bouncer").toFixed(1)} против ${dps("shooter").toFixed(1)} урона/с`);
  ok("на равные деньги толпа вышибал проигрывает стрелкам",
    power("bouncer") / T.bouncer.cost < power("shooter") / T.shooter.cost,
    `${(power("bouncer") / T.bouncer.cost).toFixed(1)} против ${(power("shooter") / T.shooter.cost).toFixed(1)} на доллар найма`);
  ok("и на равное содержание — тоже",
    power("bouncer") / T.bouncer.up < power("shooter") / T.shooter.up,
    `${Math.round(power("bouncer") / T.bouncer.up)} против ${Math.round(power("shooter") / T.shooter.up)} на доллар в секунду`);
  ok("но телом он остаётся самым дешёвым",
    Object.keys(T).every(t => t === "bouncer" || T.bouncer.cost < T[t].cost));

  // ИИ обязан это понимать: вышибала — не то, что берут «когда не хватило на бойца».
  const me = "ai1";
  g.units.filter(u => u.team === me).forEach(u => { u.hp = 0; });
  const sp = g.captureSpots(g.factionHQ(me))[0];
  for (let i = 0; i < 4; i++) g.spawnUnit("bouncer", sp.x, sp.y, me);
  g.funds[me] = 100000;
  ok("доля вышибал считается по живым", Math.round(g.bouncerShare(me) * 100) === 100,
    `${Math.round(g.bouncerShare(me) * 100)}%`);
  g.unlocks[me].shooter = true;
  const picks = new Set();
  for (let i = 0; i < 60; i++) picks.add(g.aiPickHire(me));
  ok("выбрав долю, ИИ копит на бойца, а не берёт ещё вышибалу",
    !picks.has("bouncer") && picks.has("shooter"), "выбирал: " + [...picks].join(", "));
  for (let i = 0; i < 9; i++) g.spawnUnit("shooter", sp.x, sp.y, me);
  const many = new Set();
  for (let i = 0; i < 60; i++) many.add(g.aiPickHire(me));
  ok("под своей долей вышибала снова нанимается", many.has("bouncer"),
    `доля ${Math.round(g.bouncerShare(me) * 100)}%, выбирал: ` + [...many].join(", "));

  // Первые тела доля не ограничивает: иначе фракция со стартовыми двумя бойцами
  // (один из них вышибала — уже 50%) не смогла бы взять ни одной нейтралки.
  g.units.filter(u => u.team === me).forEach(u => { u.hp = 0; });
  g.spawnUnit("bouncer", sp.x, sp.y, me);
  const first = new Set();
  for (let i = 0; i < 20; i++) first.add(g.aiPickHire(me));
  ok("первые тела берутся и сверх доли", g.BOUNCER_MIN > 1 && first.has("bouncer"),
    `порог ${g.BOUNCER_MIN}, при одном вышибале выбирал: ` + [...first].join(", "));
}

// ---------- подкрепления ИИ оплачиваются из кассы, лимита по территории больше нет ----------
{
  const g = loadGame();
  g.reset(1);
  g.businesses.filter(b => b.owner === "neutral").slice(0, 6).forEach(b => { b.owner = "ai1"; });
  g.tickEconomy(0.001);                       // посчитать доход и расход фракции
  // кассы хватает на бойцов, но не на улучшение (иначе aiUpgrade съест её первым)
  g.funds.ai1 = g.UPGRADES.strip.cost + g.AI_UP_RESERVE - 1;
  const cash = g.funds.ai1;
  const before = g.units.filter(u => u.team === "ai1").map(u => u.id);
  g.enemyAI(30);                              // таймер волны прошёл
  const fresh = g.units.filter(u => u.team === "ai1" && !before.includes(u.id));
  const paid = fresh.reduce((s, u) => s + g.TYPES[u.type].cost, 0);
  ok("волна подкреплений оплачена из кассы фракции",
    fresh.length > 0 && Math.round(g.funds.ai1) === cash - paid,
    `бойцов ${fresh.length} на $${paid}, касса ${cash} → ${Math.round(g.funds.ai1)}`);

  g.funds.ai1 = 0;                            // денег нет — подкреплений нет
  const n = g.units.filter(u => u.team === "ai1").length;
  g.enemyAI(30);
  ok("без денег волна не приходит", g.units.filter(u => u.team === "ai1").length === n,
    `было ${n}, стало ${g.units.filter(u => u.team === "ai1").length}`);

  // Ворота найма — поток, а не касса: содержание не должно съесть долю дохода.
  g.fUp.ai1 = g.fInc.ai1 * g.UPKEEP_SHARE + 1;
  ok("при съеденной доле дохода ИИ не нанимает", !g.aiCanHire("ai1"),
    `расход ${Math.round(g.fUp.ai1)} при доходе ${g.fInc.ai1}`);
  g.fUp.ai1 = 0;
  ok("с запасом дохода ИИ нанимает", g.aiCanHire("ai1"));
  // Ворота классов у ИИ прежние — территориальные (AI_BRIBE), деньгами их не обойти.
  g.funds.ai1 = 100000;
  const hired = new Set();
  for (let i = 0; i < 60; i++) { const t = g.aiPickHire("ai1"); if (t) hired.add(t); }
  ok("класс, ещё не открытый территорией, за деньги не нанимается",
    !g.unlocks.ai1.undertaker && !hired.has("undertaker"),
    "нанимал: " + [...hired].join(", "));
}

// ---------- армию ИИ держат деньги, а не число занятых точек ----------
{
  const g = loadGame();
  g.reset(1);
  const hq = g.factionHQ("ai1");
  hq.income = 200;                            // одна точка, но богатая
  // Боевой класс открыт: армию из одних вышибал доктрина найма не даст собрать и с кассой,
  // а мерить мы здесь хотим именно отсутствие территориального лимита.
  g.unlocks.ai1.shooter = true;
  g.tickEconomy(0.001);
  g.funds.ai1 = 100000;
  for (let i = 0; i < 5; i++) g.enemyAI(30);  // пять волн подряд
  const atk = g.units.filter(u => u.team === "ai1" && u.role === "attacker").length;
  // Прежний потолок был 3+1.1*территория, то есть 4 бойца на одну точку. Теперь его нет.
  ok("одна точка не ограничивает армию, если касса тянет", atk > 4,
    `штурмовиков ${atk} при одной точке`);
  ok("волна выводит не больше WAVE_MAX за раз", atk <= 5 * g.WAVE_MAX,
    `штурмовиков ${atk} за 5 волн при WAVE_MAX=${g.WAVE_MAX}`);
}

// ---------- строка казны: доход и расход порознь, итог отдельно ----------
{
  const g = loadGame();
  g.reset(1);
  g.money = 1234.7;
  g.units.length = 0;
  // Вышибала, а не снайпер: содержание снайпера ($15/с) само по себе больше дохода штаба,
  // и «плюсовой итог» на нём не проверить — при новых ценах это уже минус.
  g.spawnUnit("bouncer", g.playerHQ().x, g.playerHQ().y, "player");   // −$2/с при доходе $10/с
  g.update(0.001);
  ok("строка казны: счёт округляется вниз", g.els.uiMoney.textContent === "$1234", g.els.uiMoney.textContent);
  ok("строка казны: доход — валовой, а не разница",
    g.els.uiInc.textContent === "+$" + g.fInc.player, g.els.uiInc.textContent);
  ok("строка казны: расход отдельной цифрой",
    g.els.uiUp.textContent === "−$" + g.fUp.player && g.fUp.player > 0, g.els.uiUp.textContent);
  ok("строка казны: бойцы посчитаны", g.els.uiArmy.textContent === "1", g.els.uiArmy.textContent);
  const net = g.fInc.player - g.fUp.player;
  ok("строка казны: итог сходится с доходом минус расход",
    g.els.uiNet.textContent === (net >= 0 ? "+$" : "−$") + Math.abs(net) && net > 0, g.els.uiNet.textContent);
  ok("строка казны: плюсовой итог зелёный", /green/.test(g.els.uiNet.style.color), g.els.uiNet.style.color);
  // уходим в минус: содержание отряда больше дохода одного штаба
  for (let i = 0; i < 6; i++) g.spawnUnit("undertaker", g.playerHQ().x, g.playerHQ().y, "player");
  g.update(0.001);
  ok("строка казны: минусовой итог красный и со знаком",
    g.els.uiNet.textContent[0] === "−" && /red/.test(g.els.uiNet.style.color),
    g.els.uiNet.textContent + " / " + g.els.uiNet.style.color);
}

// ---------- улучшенная точка: берётся дольше и достаётся захватчику ----------
{
  function grabTime(kind, raze) {
    const g = loadGame();
    g.reset(1);
    const b = g.businesses.find(x => x.owner === "neutral" && g.captureSpots(x).length);
    b.kind = kind;                                   // ничья точка с уже готовым заведением
    if (raze) g.demolish(b.owner, b);                // ...которое снесли перед боем
    const s = g.captureSpots(b)[0];
    g.spawnUnit("bouncer", s.x, s.y, "player");
    let t = 0;
    while (b.owner !== "player" && t < 120) { g.captureBusinesses(0.05); t += 0.05; }
    return { t, kind: b.kind, cap: g.CAP_UPGRADED };
  }
  const plain = grabTime(null), up = grabTime("bar");
  const exp = 1 / up.cap;
  ok("улучшенная точка захватывается медленнее", up.t > plain.t * (exp - 0.15) && up.t < plain.t * (exp + 0.15),
    `обычная ${plain.t.toFixed(1)}с, улучшенная ${up.t.toFixed(1)}с, ожидалось ×${exp.toFixed(2)}`);
  ok("улучшение переходит к захватчику вместе с точкой", up.kind === "bar");
  // Снос снимает и надбавку к времени захвата: защищаться сносом нельзя, это выжженная земля
  const razed = grabTime("bar", true);
  ok("снесённая точка снова берётся с обычной скоростью",
    razed.kind === null && razed.t < plain.t * 1.15,
    `снесённая ${razed.t.toFixed(1)}с против обычной ${plain.t.toFixed(1)}с`);
}

// ---------- ИИ улучшает по тем же правилам и из своего кошелька ----------
{
  const g = loadGame();
  g.reset(1);
  let b = g.businesses.find(x => x.owner === "ai1" && !x.hq);
  if (!b) { b = g.businesses.find(x => x.owner === "neutral"); b.owner = "ai1"; }
  g.funds.ai1 = 5000;
  g.aiUpgrade("ai1");
  const bought = g.businesses.find(x => x.owner === "ai1" && x.kind);
  ok("ИИ улучшает свою точку и платит из своего кошелька",
    !!bought && g.funds.ai1 === 5000 - g.UPGRADES[bought.kind].cost,
    `kind=${bought && bought.kind}, касса ${g.funds.ai1}`);
  ok("ИИ не улучшает штаб", g.factionHQ("ai1").kind === null);
  const c = g.businesses.find(x => x.owner === "ai1" && !x.hq && !x.kind);
  g.funds.ai1 = 50;
  g.aiUpgrade("ai1");
  ok("без денег ИИ не улучшает", !c || c.kind === null);
}

// ---------- ИИ перестраивает только когда строить негде ----------
{
  // Два стриптиза при доле 20% дают по $24; решение проблем — $36, то есть перевес
  // ×1.5 при пороге AI_SWAP_GAIN. Считаем на явных цифрах, а не на «примерно лучше».
  function world() {
    const g = loadGame();
    g.reset(1);
    g.businesses.forEach(b => { b.kind = null; });
    g.businesses.filter(b => !b.hq && b.owner !== "player").slice(0, 2)
      .forEach(b => { b.owner = "ai1"; b.kind = "strip"; });
    g.aiFavor.ai1 = "fixer";
    g.funds.ai1 = 5000;
    return g;
  }
  const g = world();
  // всё, что у ИИ есть, уже застроено — значит вкладываться больше некуда
  g.businesses.forEach(b => { if (b.owner === "ai1" && !b.hq && !b.kind) b.owner = "neutral"; });
  const worth = g.bizIncomeOf("ai1", g.businesses.find(b => b.kind === "strip"));
  ok("порог перестройки посчитан на живых числах",
    worth === 24 && g.upIncomeAt("ai1", "fixer", 1) === 36 && 36 >= worth * g.AI_SWAP_GAIN,
    `стриптиз ${worth}, решала ${g.upIncomeAt("ai1", "fixer", 1)}, порог ×${g.AI_SWAP_GAIN}`);
  g.aiUpgrade("ai1");
  ok("ИИ сносит слабое заведение, когда строить негде",
    g.businesses.filter(b => b.owner === "ai1" && b.kind === "fixer").length === 1 &&
    g.businesses.filter(b => b.owner === "ai1" && b.kind === "strip").length === 1 &&
    g.funds.ai1 === 5000 - g.UPGRADES.fixer.cost,
    `касса ${g.funds.ai1}`);

  const h = world();                       // та же расстановка, но есть ровно одна чистая точка
  h.businesses.forEach(b => { if (b.owner === "ai1" && !b.hq && !b.kind) b.owner = "neutral"; });
  const free = h.businesses.find(b => b.owner === "neutral" && !b.hq && !b.kind);
  free.owner = "ai1";
  h.aiUpgrade("ai1");
  ok("пока есть куда строить, ИИ ничего не сносит",
    free.kind === "fixer" && h.businesses.filter(b => b.owner === "ai1" && b.kind === "strip").length === 2,
    `свободная ${free.kind}, стриптизов ${h.businesses.filter(b => b.owner === "ai1" && b.kind === "strip").length}`);

  const w = world();                       // перевес есть, но кассы на новое заведение нет
  w.businesses.forEach(b => { if (b.owner === "ai1" && !b.hq && !b.kind) b.owner = "neutral"; });
  w.funds.ai1 = 100;
  w.aiUpgrade("ai1");
  ok("без денег ИИ не сносит и не остаётся с голой точкой",
    w.businesses.filter(b => b.owner === "ai1" && b.kind === "strip").length === 2);
}

// ---------- тренировочный центр: точка сбора найма ----------
// Единственное заведение, которое не про доход, а про логистику: его проверяем
// отдельно от рынка — по расходу, по сбору и по тому, что ИИ его не строит.
{
  const g = loadGame();
  g.reset(1);
  const hq = g.playerHQ();
  // берём точку ПОДАЛЬШЕ от штаба: иначе «боец вышел у центра, а не у штаба» ничего не значит
  let mine = null, md = -1;
  for (const b of g.businesses) {
    if (b.hq) continue;
    const d = Math.hypot(b.x - hq.x, b.y - hq.y);
    if (d > md) { md = d; mine = b; }
  }
  mine.owner = "player";
  g.money = 5000;

  ok("сбор по умолчанию в штабе", g.rallyPoint("player") === hq);
  ok("простая точка сбор не держит", !g.canRally("player", mine) && !g.setRally("player", mine));

  const cash = g.money;
  ok("центр покупается как улучшение", g.buyUpgrade("player", mine, "gym") &&
    mine.kind === "gym" && g.money === cash - g.UPGRADES.gym.cost);
  ok("центр не даёт дохода", g.bizIncome(mine) === 0 && g.bizBaseIncome(mine) === 0);
  // Цифра берётся из UPGRADES: содержание центра удвоено вместе со всей экономикой,
  // и вписанное руками число разъехалось бы с ней при следующей же правке цен.
  const gymUp = g.UPGRADES.gym.upkeep;
  ok(`центр стоит $${gymUp}/с`, g.bizUpkeep(mine) === gymUp && gymUp > 0);
  ok("на плитке у центра расход, а не $0", g.bizTag(mine) === "−$" + gymUp, g.bizTag(mine));
  g.tickEconomy(0.001);
  ok("содержание центра попало в расход фракции", g.fUp.player >= gymUp,
    `расход ${g.fUp.player}`);

  ok("сбор переносится на свой центр", g.setRally("player", mine) && g.rallyPoint("player") === mine);
  const before = g.units.length;
  g.selectBuy("bouncer");
  const fresh = g.units[g.units.length - 1];
  ok("наём идёт в точку сбора, а не в штаб", g.units.length === before + 1 &&
    Math.hypot(fresh.x - mine.x, fresh.y - mine.y) < Math.hypot(fresh.x - hq.x, fresh.y - hq.y),
    `до центра ${Math.round(Math.hypot(fresh.x - mine.x, fresh.y - mine.y))}, ` +
    `до штаба ${Math.round(Math.hypot(fresh.x - hq.x, fresh.y - hq.y))}`);

  ok("сбор возвращается в штаб той же кнопкой", g.setRally("player", null) &&
    g.rallyPoint("player") === hq);
  const back = g.units.length;
  g.selectBuy("bouncer");
  const home = g.units[g.units.length - 1];
  ok("после возврата наём снова у штаба", g.units.length === back + 1 &&
    Math.hypot(home.x - hq.x, home.y - hq.y) < Math.hypot(home.x - mine.x, home.y - mine.y));

  // разбор центра и его потеря обязаны сами возвращать сбор: хук в demolish и в захвате
  // легко забыть, поэтому rallyPoint проверяет зал по факту на каждом обращении
  g.setRally("player", mine);
  ok("центр разбирается, как и любое заведение", g.canDemolish("player", mine) &&
    g.demolish("player", mine) && mine.kind === null);
  ok("разобранный центр возвращает сбор в штаб", g.rallyPoint("player") === hq);
  g.buyUpgrade("player", mine, "gym"); g.setRally("player", mine);
  mine.owner = "ai1";
  ok("отбитый врагом центр возвращает сбор в штаб", g.rallyPoint("player") === hq);
  ok("чужой центр точкой сбора не назначить", !g.canRally("player", mine) && !g.setRally("player", mine));
}

// ИИ и бот в сим тренировочный центр не строят: подкрепления ИИ и так выходят
// у случайной СВОЕЙ точки, то есть сбор у него распределён даром. Пустить его
// в жадность по «доходу на доллар» — значит дать ИИ денежную дыру, которой у игрока нет.
{
  const g = loadGame();
  g.reset(3);
  ok("любимый тип ИИ — только доходный",
    Object.values(g.aiFavor).every(k => g.MARKET_KEYS.includes(k)),
    JSON.stringify(g.aiFavor));
  g.businesses.forEach(b => { if (!b.hq) b.owner = "ai1"; });
  for (let i = 0; i < 40; i++) { g.funds.ai1 = 9000; g.aiUpgrade("ai1"); }
  ok("ИИ не строит тренировочных центров",
    g.businesses.every(b => b.kind !== "gym"),
    g.businesses.filter(b => b.kind === "gym").length + " шт");
}

// ---------- панель улучшений ----------
{
  const g = loadGame();
  g.reset(1);
  g.money = 5000; g.update(0.001);
  ok("панель: без выбора кнопки улучшений выключены", g.els.buyUpBar.disabled === true);
  ok("панель: без выбора сносить нечего",
    g.els.btnDemolish.disabled === true && g.els.costDemolish.textContent === "—");
  ok("панель: цена улучшения на месте", g.els.costUpBar.textContent === "$" + g.UPGRADES.bar.cost,
    g.els.costUpBar.textContent);
  g.selBiz = g.playerHQ(); g.update(0.001);
  ok("панель: штаб улучшать не даёт",
    g.els.buyUpBar.disabled === true && /Штаб/.test(g.els.upSel.textContent), g.els.upSel.textContent);
  const mine = g.businesses.find(b => b.owner === "neutral" && !b.hq);   // захваченная по ходу партии
  mine.owner = "player";
  g.selBiz = mine; g.update(0.001);
  ok("панель: своя точка включает кнопки", g.els.buyUpBar.disabled === false);
  // Рынок переехал из правого меню в строку казны сверху, но остаётся тем же #market
  ok("строка казны: рынок показывает свою долю и размер",
    /Бар<\/div><div class="v">0%<small>0 из 10</.test(g.els.market.innerHTML), g.els.market.innerHTML);
  g.playerUpgrade("strip"); g.update(0.001);
  ok("панель: после улучшения кнопки гаснут", g.els.buyUpBar.disabled === true && mine.kind === "strip");
  ok("строка казны: доля в целых процентах",
    /Стриптиз<\/div><div class="v">10%<small>1 из 10</.test(g.els.market.innerHTML), g.els.market.innerHTML);
  // Снос и улучшение — взаимно исключающие кнопки: включена всегда ровно одна сторона
  ok("панель: после улучшения снос включён и назван",
    g.els.btnDemolish.disabled === false && g.els.costDemolish.textContent === g.UPGRADES.strip.short,
    g.els.costDemolish.textContent);
  g.playerDemolish(); g.update(0.001);
  ok("панель: снос возвращает точку в простое состояние",
    mine.kind === null && g.els.btnDemolish.disabled === true && g.els.buyUpBar.disabled === false);
  // потеря точки снимает выбор сама, без отдельного хука в захвате
  mine.owner = "ai1"; g.update(0.001);
  ok("панель: потерянная точка снимает выбор", g.selBiz === null);
}

// ---------- панель: кнопка точки сбора ----------
{
  const g = loadGame();
  g.reset(1);
  g.money = 5000; g.update(0.001);
  ok("панель: без выбора переносить сбор некуда",
    g.els.btnRally.disabled === true && g.els.costRally.textContent === "—");
  // штаб — точка сбора по умолчанию, но отдельной кнопки у него нет: сбор и так его
  g.selBiz = g.playerHQ(); g.update(0.001);
  ok("панель: у штаба кнопка сбора выключена и подписана «в штабе»",
    g.els.btnRally.disabled === true && g.els.costRally.textContent === "в штабе",
    g.els.costRally.textContent);
  const mine = g.businesses.find(b => b.owner === "neutral" && !b.hq);
  mine.owner = "player";
  g.selBiz = mine; g.update(0.001);
  ok("панель: простая точка сбор не держит",
    g.els.btnRally.disabled === true && g.els.costRally.textContent === "нужен зал",
    g.els.costRally.textContent);
  g.playerUpgrade("gym"); g.update(0.001);
  ok("панель: у своего центра кнопка сбора включена",
    g.els.btnRally.disabled === false && g.els.costRally.textContent === "сюда" &&
    /Перенести/.test(g.els.rallyLabel.textContent), g.els.rallyLabel.textContent);
  ok("панель: у центра в шапке расход, а не доход",
    g.els.upSel.textContent.includes("−$" + g.UPGRADES.gym.upkeep + "/с"), g.els.upSel.textContent);
  g.playerRally(); g.update(0.001);
  ok("панель: кнопка перенесла сбор и стала обратной",
    g.rallyPoint("player") === mine && g.els.costRally.textContent === "здесь" &&
    /Вернуть/.test(g.els.rallyLabel.textContent), g.els.rallyLabel.textContent);
  g.playerRally(); g.update(0.001);
  ok("панель: та же кнопка вернула сбор в штаб",
    g.rallyPoint("player") === g.playerHQ() && g.els.costRally.textContent === "сюда");
  // рынок — только доходные типы: у зала доли нет, и строки о нём быть не должно
  ok("панель: центра нет среди строк рынка",
    !new RegExp(g.UPGRADES.gym.name).test(g.els.market.innerHTML), g.els.market.innerHTML);
}

// ---------- разметка: кнопка на каждый тип заведения ----------
// els доказывает только то, что код СПРОСИЛ элемент; сама разметка пишется руками,
// и забытая кнопка вылезла бы уже в браузере. Поэтому читаем HTML.
{
  const html = require("fs").readFileSync(GAME, "utf8");
  const g = loadGame();
  const cap = k => k[0].toUpperCase() + k.slice(1);
  const miss = g.UP_KEYS.filter(k => !html.includes(`id="buyUp${cap(k)}"`) ||
                                     !html.includes(`id="costUp${cap(k)}"`));
  ok("у каждого типа заведения своя кнопка в разметке", miss.length === 0, "нет: " + miss.join(", "));
}

// ---------- контекстная панель у самого заведения ----------
// Улучшение и снос живут не в правом меню, а в панельке, которая стоит вплотную
// к выбранной точке. Значит, проверять надо не только состояние кнопок, но и место.
{
  const g = loadGame();
  g.reset(1, 4242);          // сид, а не случайная карта: место панели считается от точек карты
  g.money = 5000; g.update(0.001);
  const panel = g.els.bizPanel;
  ok("панелька: без выбора её нет вовсе", panel.style.display === "none");
  // берём точку поближе к центру мира: камера тогда центрируется на ней без упора в clampCam
  const cx = g.WORLD_W / 2, cy = g.WORLD_H / 2;
  let mine = null, md = 1e9;
  for (const b of g.businesses) {
    if (b.hq || b.owner !== "neutral") continue;
    const d = Math.hypot(b.x - cx, b.y - cy);
    if (d < md) { md = d; mine = b; }
  }
  mine.owner = "player";
  g.cam.zoom = 1; g.cam.x = mine.x - 600; g.cam.y = mine.y - 400;   // точка в центре экрана 1200x800
  g.selBiz = mine; g.update(0.001);
  const left = parseFloat(panel.style.left), top = parseFloat(panel.style.top);
  const s = g.w2s(mine.x, mine.y);
  ok("панелька: с выбором показана", panel.style.display === "block");
  // сбоку от плитки (отступ = полклетки на зуме + 12), по вертикали — серединой к точке
  ok("панелька: стоит вплотную к своей точке",
    Math.abs(left - (s.x + g.TILE / 2 + 12)) < 2 && Math.abs(top + g.BIZ_PANEL_H / 2 - s.y) < 4,
    `${left},${top}`);
  g.cam.x -= 200; g.update(0.001);
  ok("панелька: едет вместе с камерой",
    Math.abs(parseFloat(panel.style.left) - (left + 200)) < 2,
    `${left} → ${panel.style.left}`);
  // зум меняет и отступ: панель считается тем же w2s, что и рендер
  g.cam.zoom = 1.5; g.cam.x = mine.x - 400; g.cam.y = mine.y - 800 / 3; g.update(0.001);
  const s2 = g.w2s(mine.x, mine.y);
  ok("панелька: держится точки и на зуме",
    Math.abs(parseFloat(panel.style.left) - (s2.x + g.TILE / 2 * 1.5 + 12)) < 2, panel.style.left);
  // У правого края панель уходит на другую сторону: накрывать собой саму точку ей нельзя.
  // Центральную точку сюда брать нельзя: на маленькой карте камера упирается в clampCam
  // раньше, чем точка доедет до правого края экрана, и проверка мерила бы зажим камеры,
  // а не панель. Берём самую правую точку — до её края камера доходит с запасом.
  let edge = null;
  for (const b of g.businesses) if (!b.hq && (!edge || b.x > edge.x)) edge = b;
  edge.owner = "player";
  g.cam.zoom = 1; g.cam.x = edge.x - 1100; g.cam.y = edge.y - 400;   // точка у правого края 1200px
  g.setSelBiz(edge); g.update(0.001);
  const s3 = g.w2s(edge.x, edge.y);
  ok("панелька: у правого края уходит влево от точки",
    Math.abs(s3.x - 1100) < 1 &&                                     // камера не упёрлась в зажим
    parseFloat(panel.style.left) + g.BIZ_PANEL_W <= s3.x - g.TILE / 2, `${panel.style.left} при x=${s3.x}`);
  g.setSelBiz(mine);
  // миникарта — тоже интерфейс: под панелью она бы не кликалась
  g.cam.x = mine.x - 60; g.cam.y = mine.y - 740; g.update(0.001);   // точка в левом нижнем углу
  const mm = g.mmRect();
  ok("панелька: миникарту не накрывает",
    parseFloat(panel.style.top) + g.BIZ_PANEL_H <= mm.y - 5 || parseFloat(panel.style.left) > mm.x + mm.w,
    `${panel.style.left},${panel.style.top} при миникарте ${mm.x},${mm.y}`);
  // на паузе update не идёт — закрытие и выбор обязаны действовать сразу
  g.setSelBiz(null);
  ok("панелька: закрывается сразу, не дожидаясь кадра", panel.style.display === "none");
  g.setSelBiz(mine);
  ok("панелька: открывается сразу, не дожидаясь кадра", panel.style.display === "block");
}

// ---------- рельеф и генератор карт ----------
// Генератор сидирован, поэтому здесь можно проверять конкретные карты, а не только
// агрегат: набор сидов фиксирован и любая регрессия генератора его валит.
{
  const SEEDS = [1007, 2007, 3007, 4007, 5007, 6007, 7007, 8007, 9007, 10007, 11007, 12007];
  const g = loadGame();
  const T = g.T, TL = g.TILE;
  const cells = fn => { const out = []; for (let r = 0; r < g.ROWS; r++) for (let c = 0; c < g.COLS; c++) if (fn(g.grid[r][c], c, r)) out.push([c, r]); return out; };
  const found = { water: 0, bridge: 0, park: 0, pond: 0, plaza: 0, alley: 0 };
  const bad = { comp: [], spots: [], hq: [], pondEdge: [], shapes: [], types: [], cover: [] };

  for (const s of SEEDS) {
    g.reset(2, s);
    const has = t => cells(v => v === t).length > 0;
    if (has(T.WATER)) found.water++;
    if (has(T.BRIDGE)) found.bridge++;
    if (has(T.PARK)) found.park++;
    if (has(T.POND)) found.pond++;
    if (has(T.PLAZA)) found.plaza++;
    if (cells((v, c, r) => v === T.ROAD && !g.isRoadCol[c] && !g.isRoadRow[r]).length) found.alley++;

    if (![T.WATER, T.BRIDGE, T.PARK, T.PLAZA].every(has)) bad.types.push(s);
    if (g.landComponents().sizes.length !== 1) bad.comp.push(s);
    if (!g.businesses.every(b => g.captureSpots(b).length)) bad.spots.push(s);
    if (new Set(g.buildings.map(b => b.w + "x" + b.h)).size < 3) bad.shapes.push(s);

    // Каждая клетка дома обязана лежать в каком-то пятне: дом рисуется по buildings[],
    // а непокрытая клетка ушла бы в ветку «дорога» и стала бы асфальтовой дырой,
    // сквозь которую не пройти и не выстрелить.
    const cov = new Set();
    g.buildings.forEach(b => b.cells.forEach(([c, r]) => cov.add(r * g.COLS + c)));
    if (cells(v => v === T.BLD || v === T.BIZ).some(([c, r]) => !cov.has(r * g.COLS + c))) bad.cover.push(s);

    // штабы взаимно достижимы — иначе партия не может закончиться захватом
    const hqs = g.factions.map(f => g.factionHQ(f));
    const from = g.captureSpots(hqs[0])[0];
    if (!hqs.slice(1).every(h => { const d = g.captureSpots(h)[0]; return !!g.findPath(from.x, from.y, d.x, d.y); })) bad.hq.push(s);

    // пруд обязан лежать в траве: отступ в клетку и есть гарантия, что он ничего не отрезает
    const leaky = cells(v => v === T.POND).some(([c, r]) =>
      [[0, -1], [0, 1], [-1, 0], [1, 0]].some(([dc, dr]) => {
        const n = g.inMap(c + dc, r + dr) ? g.grid[r + dr][c + dc] : T.BLD;
        return n !== T.PARK && n !== T.POND;
      }));
    if (leaky) bad.pondEdge.push(s);
  }

  const n = SEEDS.length;
  ok("генератор: канал есть на каждой карте", found.water === n, `${found.water}/${n}`);
  ok("генератор: мост есть на каждой карте", found.bridge === n, `${found.bridge}/${n}`);
  ok("генератор: парк есть на каждой карте", found.park === n, `${found.park}/${n}`);
  ok("генератор: площадь есть на каждой карте", found.plaza === n, `${found.plaza}/${n}`);
  ok("генератор: пруд встречается", found.pond >= n * 0.5, `${found.pond}/${n}`);
  ok("генератор: переулки встречаются", found.alley >= n * 0.5, `${found.alley}/${n}`);
  ok("генератор: все обязательные типы клеток на месте", !bad.types.length, `сиды ${bad.types}`);
  ok("генератор: земля односвязна — берега сшиты мостами", !bad.comp.length, `сиды ${bad.comp}`);
  ok("генератор: у каждой точки есть подход", !bad.spots.length, `сиды ${bad.spots}`);
  ok("генератор: штабы взаимно достижимы", !bad.hq.length, `сиды ${bad.hq}`);
  ok("генератор: пруд окружён травой", !bad.pondEdge.length, `сиды ${bad.pondEdge}`);
  ok("генератор: дома разной формы", !bad.shapes.length, `сиды ${bad.shapes}`);
  ok("генератор: каждая клетка дома лежит в пятне застройки", !bad.cover.length, `сиды ${bad.cover}`);

  // Вода: не пройти, но выстрелить и увидеть — можно. Это и есть смысл расщепления
  // passable/blocksSight; сведёте их обратно в один предикат — упадёт ровно здесь.
  g.reset(2, SEEDS[0]);
  const wet = cells(v => v === T.WATER);
  ok("через воду не ходят", wet.every(([c, r]) => !g.passable(c, r)), `${wet.length} клеток воды`);
  ok("вода луч не держит", wet.every(([c, r]) => !g.blocksSight(c, r)));
  // берега напротив друг друга: стрелять через канал можно
  let across = null;
  for (const [c, r] of wet) {
    if (g.passable(c - 1, r) && g.passable(c + 1, r)) { across = [[c - 1, r], [c + 1, r]]; break; }
    if (g.passable(c, r - 1) && g.passable(c, r + 1)) { across = [[c, r - 1], [c, r + 1]]; break; }
  }
  ok("нашлись берега напротив друг друга", !!across);
  if (across) {
    const [[ac, ar], [bc, br]] = across;
    ok("через канал стреляют", g.hasLOS(ac * TL + TL / 2, ar * TL + TL / 2, bc * TL + TL / 2, br * TL + TL / 2),
      `${ac},${ar} -> ${bc},${br}`);
  }

  const parkCells = cells(v => v === T.PARK);
  ok("парк проходим", parkCells.every(([c, r]) => g.passable(c, r)), `${parkCells.length} клеток`);
  ok("парк луч не держит", parkCells.every(([c, r]) => !g.blocksSight(c, r)));
  ok("пруд непроходим, но луч не держит",
    cells(v => v === T.POND).every(([c, r]) => !g.passable(c, r) && !g.blocksSight(c, r)));
  const brCells = cells(v => v === T.BRIDGE);
  ok("мост проходим", brCells.every(([c, r]) => g.passable(c, r)), `${brCells.length} клеток моста`);
  ok("мостов мало — это чокпоинты", brCells.length <= 12, `${brCells.length} клеток моста`);
  ok("дом и заведение держат луч",
    cells(v => v === T.BLD || v === T.BIZ).every(([c, r]) => g.blocksSight(c, r) && !g.passable(c, r)));

  // Детерминизм: без него сид бесполезен и весь блок выше ничего не проверяет.
  const snap = () => g.grid.map(row => row.join("")).join("|");
  g.reset(2, 4242); const a = snap();
  g.reset(2, 4242); const b = snap();
  g.reset(2, 777);  const c = snap();
  ok("один сид — одна и та же карта", a === b);
  ok("разные сиды — разные карты", a !== c);
  ok("сид карты записан", g.mapSeed > 0, `mapSeed=${g.mapSeed}`);
}

// ---------- размер карты: три пресета, выбор перед партией ----------
// COLS/ROWS/BIZ_CAP стали переменными, а на них завязаны буферы (туман, волна BFS)
// и рендер. Здесь проверяется, что размер переезжает целиком, а не наполовину.
{
  const g = loadGame();
  const SEEDS = [3001, 3002, 3003, 3004];
  const keys = g.SIZE_KEYS;

  ok("размеров ровно три", keys.length === 3, keys.join(", "));
  // Дефолт тестов и дефолт игры — РАЗНЫЕ, и их легко случайно свести: тесты гоняют десятки
  // миров подряд (большая карта делает прогон дорогим), а игра открывается на большой.
  ok("тесты по умолчанию идут на маленькой карте", g.mapSize === "small", g.mapSize);
  ok("в игре по умолчанию средняя карта", g.DEFAULT_SIZE === "normal" && g.wantSize === "normal",
    `${g.DEFAULT_SIZE} / ${g.wantSize}`);
  ok("у каждого размера своя кнопка на старте", keys.every(k => g.els[g.szId(k)]),
    "нет кнопки: " + keys.filter(k => !g.els[g.szId(k)]).join(", "));

  // лесенка: и площадь, и число точек растут вместе — плотность точек примерно одна,
  // иначе размер тайком стал бы рычагом сложности сам по себе
  const area = k => g.MAP_SIZES[k].cols * g.MAP_SIZES[k].rows;
  ok("площадь растёт от размера к размеру",
    keys.every((k, i) => i === 0 || area(k) > area(keys[i - 1])),
    keys.map(k => `${k} ${area(k)}`).join(", "));
  ok("число точек растёт вместе с площадью",
    keys.every((k, i) => i === 0 || g.MAP_SIZES[k].biz > g.MAP_SIZES[keys[i - 1]].biz),
    keys.map(k => `${k} ${g.MAP_SIZES[k].biz}`).join(", "));
  // Плотность точек на маленькой карте выше не по недосмотру: партия на четыре фракции
  // требует минимум 16 точек (validateBiz), и на 520 клетках честная доля большой карты
  // (≈15) в этот минимум не влезает. Разбег ограничен, чтобы «маленький» не превратился
  // в карту, где точек столько же, сколько на большой, — тогда он стал бы просто лёгким.
  const dens = keys.map(k => g.MAP_SIZES[k].biz / area(k));
  ok("плотность точек по размерам расходится в пределах четверти",
    Math.max(...dens) / Math.min(...dens) < 1.25,
    keys.map((k, i) => `${k} ${(dens[i] * 1000).toFixed(1)}‰`).join(", "));
  ok("на самом маленьком есть запас над минимумом четырёх фракций",
    g.MAP_SIZES[keys[0]].biz >= 18, `${g.MAP_SIZES[keys[0]].biz} точек против минимума 16`);

  const bad = { grid: [], comp: [], spots: [], hq: [], plain: [], few: [] };
  for (const k of keys) {
    const s = g.MAP_SIZES[k];
    for (const seed of SEEDS) {
      g.reset(3, seed, k);
      if (g.COLS !== s.cols || g.ROWS !== s.rows || g.WORLD_W !== s.cols * g.TILE ||
          g.WORLD_H !== s.rows * g.TILE || g.BIZ_CAP !== s.biz ||
          g.grid.length !== s.rows || g.grid[0].length !== s.cols) bad.grid.push(k + "/" + seed);
      // plainGrid — аварийный откат без рельефа: на нём нет воды. Если сюда попадаем,
      // значит biz задран выше того, что генератор реально размещает на этой площади.
      if (!g.grid.some(row => row.includes(g.T.WATER))) bad.plain.push(k + "/" + seed);
      if (g.businesses.length < Math.max(12, g.factions.length * 4)) bad.few.push(k + "/" + seed);
      if (g.landComponents().sizes.length !== 1) bad.comp.push(k + "/" + seed);
      if (!g.businesses.every(b => g.captureSpots(b).length)) bad.spots.push(k + "/" + seed);
      const hqs = g.factions.map(f => g.factionHQ(f));
      const from = g.captureSpots(hqs[0])[0];
      if (!hqs.slice(1).every(h => !!g.findPath(from.x, from.y, g.captureSpots(h)[0].x, g.captureSpots(h)[0].y)))
        bad.hq.push(k + "/" + seed);
    }
  }
  ok("размер переехал целиком: COLS/ROWS/WORLD/BIZ_CAP и сама сетка", !bad.grid.length, bad.grid.join(", "));
  ok("рельеф генерируется на всех размерах, без отката в plainGrid", !bad.plain.length, bad.plain.join(", "));
  ok("точек хватает на четыре фракции на любом размере", !bad.few.length, bad.few.join(", "));
  ok("земля односвязна на всех размерах", !bad.comp.length, bad.comp.join(", "));
  ok("у каждой точки есть подход на всех размерах", !bad.spots.length, bad.spots.join(", "));
  ok("штабы взаимно достижимы на всех размерах", !bad.hq.length, bad.hq.join(", "));

  // Буферы, посчитанные по COLS*ROWS, обязаны переехать вместе с картой: большая карта,
  // потом маленькая — самый опасный порядок, старый буфер длиннее и молча «работает».
  g.reset(2, 3001, "large");
  g.reset(2, 3001, "small");
  const cells = g.COLS * g.ROWS;
  ok("туман переехал на новый размер", g.factions.every(f => g.vis[f].length === cells),
    g.factions.map(f => g.vis[f].length).join(", "));
  const hq = g.playerHQ();
  ok("волна BFS переехала на новый размер", g.distFrom(hq.x, hq.y).length === cells);
  ok("камера зажимается по новому миру", (g.cam.x < g.WORLD_W && g.cam.y < g.WORLD_H),
    `cam ${Math.round(g.cam.x)},${Math.round(g.cam.y)} мир ${g.WORLD_W}x${g.WORLD_H}`);

  // Размер держится между партиями: «Заново» не должно втихую вернуть игрока на большую карту.
  g.reset(2, 3002);
  ok("без явного размера партия идёт на прежнем", g.mapSize === "small" && g.COLS === g.MAP_SIZES.small.cols,
    `${g.mapSize} ${g.COLS}x${g.ROWS}`);

  // Выбор на стартовом экране — отдельно от живого мира: кнопка не должна менять
  // COLS/ROWS под уже нарисованной картой.
  g.pickSize("large");
  ok("кнопка размера не трогает живой мир", g.mapSize === "small" && g.wantSize === "large",
    `mapSize=${g.mapSize} wantSize=${g.wantSize}`);
  ok("выбранная кнопка размера подсвечена", g.els[g.szId("large")].className.includes("on") &&
    !g.els[g.szId("small")].className.includes("on"),
    `${g.els[g.szId("large")].className} | ${g.els[g.szId("small")].className}`);
  g.pickSize("нетакого");
  ok("неизвестный размер игнорируется", g.wantSize === "large");
}

// ---------- стартовый экран: переключатели + одна кнопка «Начать» ----------
{
  const g = loadGame();
  ok("у каждого числа противников своя кнопка", [1, 2, 3].every(n => g.els["ovN" + n]));
  ok("кнопка «Начать» есть", !!g.els.ovGo);
  ok("галка «Без тумана» есть", !!g.els.ovNoFog);

  // Число противников — теперь переключатель, а не старт: клик по нему партию не начинает.
  const before = g.factions.length;
  g.pickAI(3);
  ok("кнопка противников партию не начинает", g.wantAI === 3 && g.factions.length === before,
    `wantAI=${g.wantAI}, фракций ${g.factions.length} было ${before}`);
  ok("выбранное число противников подсвечено",
    g.els.ovN3.className.includes("on") && !g.els.ovN2.className.includes("on"),
    `${g.els.ovN3.className} | ${g.els.ovN2.className}`);
  g.pickAI(9);
  ok("число противников зажато в 1..3", g.wantAI === 3, `wantAI=${g.wantAI}`);

  // «Начать» собирает мир из всех трёх переключателей разом.
  g.pickSize("normal"); g.pickAI(2); g.setNoFog(false);
  g.startGame();
  ok("«Начать» строит мир по выбранным настройкам",
    g.factions.length === 3 && g.mapSize === "normal" && g.fogOn === true,
    `фракций ${g.factions.length}, ${g.mapSize}, туман ${g.fogOn}`);
  ok("стартовый экран убран", g.els.over.style.display === "none");

  // На конце партии выбирать нечего: показана только «Заново».
  g.showOver(false);
  ok("на конце партии показана только «Заново»",
    g.els.ovAgain.style.display === "inline-block" && g.els.ovGo.style.display === "none" &&
    g.els.ovStart.style.display === "none",
    `назад=${g.els.ovAgain.style.display} начать=${g.els.ovGo.style.display}`);

  // Выбор держится между партиями: «Заново» не должно втихую вернуть настройки к дефолту.
  g.showStart();
  ok("«Заново» показывает прежний выбор",
    g.wantSize === "normal" && g.wantAI === 2 && g.els.ovN2.className.includes("on") &&
    g.els[g.szId("normal")].className.includes("on"), `${g.wantSize} / ${g.wantAI}`);
  ok("стартовый экран снова предлагает «Начать»",
    g.els.ovGo.style.display === "inline-block" && g.els.ovAgain.style.display === "none");
}

// ---------- «Без тумана войны»: снимается сразу у всех сторон ----------
{
  const g = loadGame();
  ok("по умолчанию туман включён", g.wantFog === true && !g.els.ovNoFog.checked);

  g.reset(2, 8001);
  const enemy = g.units.find(u => u.team !== "player");
  ok("с туманом чужой боец на старте не виден", !g.canSee("player", enemy.x, enemy.y));

  g.setNoFog(true);
  ok("галка «Без тумана» гасит туман только в выборе, не в живом мире",
    g.wantFog === false && g.fogOn === true, `wantFog=${g.wantFog} fogOn=${g.fogOn}`);

  g.reset(2, 8001, undefined, false);
  ok("новая партия идёт без тумана", g.fogOn === false);
  const e2 = g.units.find(u => u.team !== "player");
  ok("без тумана чужой боец виден сразу", g.canSee("player", e2.x, e2.y));
  // Симметрия — не украшение: фогнуть одну сторону значит мерить не сложность, а читерство.
  ok("без тумана видят ВСЕ стороны, а не только игрок",
    g.factions.every(f => g.units.every(u => g.canSee(f, u.x, u.y))));
  // vis читают и рендер, и тесты: «видно всё» обязано выглядеть одинаково во всех местах
  g.updateVision(1);
  ok("без тумана vis заполнен целиком",
    g.factions.every(f => g.vis[f].every(v => v === 1)));
  const foreign = g.businesses.find(b => b.owner !== "player" && b.owner !== "neutral");
  ok("без тумана владелец чужой точки известен",
    g.knownOwner("player", foreign) === foreign.owner,
    `${g.knownOwner("player", foreign)} вместо ${foreign.owner}`);
  // Обратно: следующая партия с туманом снова прячет чужих.
  g.reset(2, 8001, undefined, true);
  const e3 = g.units.find(u => u.team !== "player");
  ok("туман возвращается следующей партией", g.fogOn === true && !g.canSee("player", e3.x, e3.y));
}

// ---------- звук: выстрелы фогнуты, тумблеры едины, джаз идёт ----------
{
  // с заглушкой WebAudio: без неё весь звуковой модуль — no-op (это проверяется ниже отдельно)
  const g = loadGame(1200, 800, { audio: true });
  g.reset(1);
  g.audioInit();
  const log = g.audioLog;
  const wait = s => { g.actx.currentTime += s; };     // время в песочнице само не идёт
  // подпись звука: из каких узлов он собран. Разные классы обязаны звучать по-разному.
  const shot = (type, x, y) => { log.reset(); const okShot = g.sfx(type, x, y); return { okShot, sig: log.sig(), voices: log.voices }; };

  ok("звук завёлся по жесту", !!g.actx);
  ok("у каждого класса есть свой синтез выстрела",
    Object.keys(g.TYPES).every(t => typeof g.SHOTS[t] === "function"),
    Object.keys(g.TYPES).filter(t => typeof g.SHOTS[t] !== "function").join(",") || "все на месте");

  const u = g.units.find(x => x.team === "player");
  const sigs = {};
  for (const t of Object.keys(g.TYPES)) {
    wait(0.5);                                       // бюджет голосов считается в окне 0.1 с
    const r = shot(t, u.x, u.y);
    ok(`выстрел «${t}» звучит`, r.okShot && r.voices > 0, `голосов ${r.voices}`);
    sigs[t] = r.sig;
  }
  const uniq = new Set(Object.values(sigs));
  ok("у каждого класса свой звук, а не один на всех", uniq.size === Object.keys(sigs).length,
    Object.keys(sigs).map(t => `${t}: ${sigs[t]}`).join(" | "));

  // бюджет голосов: залп в одном окне не должен уходить в кашу
  wait(1);
  let fired = 0;
  for (let i = 0; i < 20; i++) if (g.sfx("shooter", u.x, u.y)) fired++;
  ok("бюджет голосов режет залп", fired > 0 && fired <= 6, `прошло ${fired} из 20`);

  // Туман: слух не должен видеть сквозь него. Камеру наводим НА врага, иначе проверка
  // прошла бы по затуханию за краем экрана, а не по обзору.
  const e = g.units.find(x => x.team !== "player");
  g.cam.x = e.x - 1200 / 2; g.cam.y = e.y - 800 / 2;
  wait(1);
  ok("чужой боец на старте не виден", !g.canSee("player", e.x, e.y));
  ok("выстрел за туманом не слышно", !shot("shooter", e.x, e.y).okShot);
  g.spawnUnit("bouncer", e.x, e.y, "player");        // подвели своего — враг проявился
  g.updateVision(1);
  wait(1);
  ok("тот же выстрел на виду слышно", shot("shooter", e.x, e.y).okShot);

  // выстрел на другом конце города — за пределами слышимости
  wait(1);
  ok("выстрел далеко за экраном не слышно",
    !shot("shooter", e.x + g.WORLD_W, e.y).okShot);

  // тумблер звуков
  g.setAudio("sfx", false, true);
  wait(1);
  const off = shot("bouncer", u.x, u.y);
  ok("при выключенных звуках не звучит ничего", !off.okShot && off.voices === 0);
  ok("галка звуков одна на панель и стартовый экран",
    g.els.optSfx.checked === false && g.els.ovSfx.checked === false,
    `панель ${g.els.optSfx.checked}, старт ${g.els.ovSfx.checked}`);
  g.setAudio("sfx", true, true);

  // джаз: планировщик раскладывает ноты вперёд, выключенный — молчит
  log.reset(); wait(4);
  const notes = g.musicTick();
  ok("джаз ставит ноты вперёд", notes > 0 && log.voices > 0, `нот ${notes}, голосов ${log.voices}`);
  ok("в джазе есть и бас, и щётки",
    log.nodes.includes("osc") && log.nodes.includes("noise"), log.nodes.join(","));
  g.setAudio("music", false, true);
  log.reset(); wait(4);
  ok("выключенный джаз не ставит нот", g.musicTick() === 0 && log.voices === 0, `голосов ${log.voices}`);
  ok("галка джаза синхронна в обоих местах",
    g.els.optMusic.checked === false && g.els.ovMusic.checked === false);
  g.setAudio("music", true, true);

  // M — общий мьют, и он возвращает ту же комбинацию, что была
  g.setAudio("music", true, true); g.setAudio("sfx", false, true);
  g.toggleMute();
  ok("M гасит всё разом", !g.musicOn && !g.sfxOn);
  g.toggleMute();
  ok("повторный M возвращает прежние галки", g.musicOn === true && g.sfxOn === false,
    `музыка ${g.musicOn}, звуки ${g.sfxOn}`);

  // Без тумана слух тоже открыт: у sfx одна проверка обзора, и она обязана слушаться флага.
  // Затухание за краем экрана при этом остаётся — туман и расстояние это разные фильтры.
  // Блок последний в секции: он пересоздаёт мир, и бойцы предыдущих проверок протухают.
  g.setAudio("sfx", true, true); g.setAudio("music", false, true);
  g.reset(1, 8002, undefined, false);
  const nf = g.units.find(x => x.team !== "player");
  g.cam.x = nf.x - 1200 / 2; g.cam.y = nf.y - 800 / 2;
  wait(1);
  ok("без тумана выстрел неразведанного бойца слышно", shot("shooter", nf.x, nf.y).okShot);
  wait(1);
  ok("без тумана далёкий выстрел всё равно не слышно",
    !shot("shooter", nf.x + g.WORLD_W, nf.y).okShot);
}

// ---------- без AudioContext игра работает как раньше ----------
{
  const g = loadGame();                              // без заглушки звука — как в песочнице tools/
  g.reset(2);
  ok("без AudioContext контекст не заводится", !g.actx);
  const u = g.units.find(x => x.team === "player"), e = g.units.find(x => x.team !== "player");
  let threw = null;
  try {
    g.audioInit(); g.audioResume(); g.audioDuck(true); g.setAudio("music", true, true);
    g.toggleMute(); g.musicTick(); g.fire(u, e);
    for (let i = 0; i < 200; i++) g.update(0.05);
  } catch (err) { threw = err; }
  ok("звуковые вызовы без AudioContext не бросают", !threw, threw && threw.message);
  ok("выстрел без звука всё равно наносит урон", e.hp < g.TYPES[e.type].hp, `hp=${e.hp}`);
}

console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : "\nвсе проверки пройдены");
process.exit(fails ? 1 : 0);
