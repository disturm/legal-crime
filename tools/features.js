// Регрессия на механики, которые баланс-сим не ловит: стартовый отряд, доход штаба,
// взятки за классы, урон снайпера по боевой стойке и правила зоны захвата.
//   node tools/features.js
const { loadGame } = require("./harness");

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
  });
}

// ---------- взятки: изначально открыт только вышибала ----------
{
  const g = loadGame();
  g.reset(1);
  ok("открыт только вышибала", g.unlocks.player.bouncer === true &&
    !g.unlocks.player.shooter && !g.unlocks.player.sniper);

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
    engaged && engaged.dmg > 0 && engaged.dmg < calm.dmg * 0.25,
    engaged && `урон ${engaged.dmg} против ${calm.dmg}`);

  ok("снайпер стреляет редко", g.TYPES.sniper.rate >= 3 &&
    g.TYPES.sniper.rate > g.TYPES.shooter.rate * 5, `rate=${g.TYPES.sniper.rate}`);

  ok("свой выстрел ставит бойца в боевую стойку", sniper.combat > 0);
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
  ok("обзор — не вся карта", seen("player") < COLS * ROWS * 0.35,
    `видно ${seen("player")} из ${COLS * ROWS} клеток`);

  // дом в глубине квартала лучом не берётся: видна только та стена, к которой примыкает
  // просматриваемая дорога. Ищем такой дом среди клеток вокруг бойца.
  const uc = Math.floor(u.x / T), ur = Math.floor(u.y / T);
  let deep = null;
  for (let dr = -2; dr <= 2 && !deep; dr++) for (let dc = -2; dc <= 2 && !deep; dc++) {
    const c = uc + dc, r = ur + dr;
    if (c < 1 || r < 1 || c >= COLS - 1 || r >= ROWS - 1) continue;
    if (g.passable(c, r)) continue;
    const walled = !g.passable(c - 1, r) && !g.passable(c + 1, r) &&
                   !g.passable(c, r - 1) && !g.passable(c, r + 1);
    if (walled) deep = [c, r];
  }
  ok("дом без выхода на дорогу не виден", !deep || !g.canSee("player", deep[0] * T + T / 2, deep[1] * T + T / 2),
    deep ? `клетка ${deep}` : "такого дома рядом не нашлось");

  // чужие бойцы на старте — за туманом
  const far = g.units.filter(x => x.team !== "player");
  ok("чужие бойцы на старте не видны", far.every(p => !g.canSee("player", p.x, p.y)),
    `видно ${far.filter(p => g.canSee("player", p.x, p.y)).length} из ${far.length}`);

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

// ---------- туман сбрасывается вместе с картой ----------
{
  const g = loadGame();
  const share = () => { const v = g.vis.player; let n = 0; for (let i = 0; i < v.length; i++) n += v[i]; return n / v.length; };
  g.reset(2);
  const first = share();
  g.reset(2);                                    // новая карта — кэш лучей обязан пересчитаться
  ok("после новой партии обзор снова узкий", share() < 0.35,
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
  ok("улучшение всегда выгоднее базы: X > 9 у всех типов",
    g.UP_KEYS.every(k => g.UPGRADES[k].X > 9), g.UP_KEYS.map(k => `${k} X=${g.UPGRADES[k].X}`).join(", "));
  ok("пустой рынок меряется полом 10", g.marketSize("bar") === 10 && g.marketPct("player", "bar") === 0);

  // 5 своих баров из 12 построенных: пол больше не действует, доля округляется до целых
  const pool = plain.slice(0, 12);
  pool.forEach((b, i) => { b.kind = "bar"; b.owner = i < 5 ? "player" : "ai1"; });
  ok("рынок больше пола меряется числом заведений", g.marketSize("bar") === 12);
  ok("доля округляется до целых процентов", g.marketPct("player", "bar") === 42,
    `доля ${g.marketPct("player", "bar")}%`);                       // 5/12 = 41.67
  ok("доход бара по формуле X*(1+Y*доля)", g.bizIncomeOf("player", pool[0]) === 22,
    `${g.bizIncomeOf("player", pool[0])} вместо 22`);               // 12*(1+2*0.42)
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
  const mine = g.businesses.find(b => b.owner === "player" && !b.hq);
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
  const two = g.businesses.find(b => b.owner === "player" && !b.hq && !b.kind);
  g.money = 50;
  ok("без денег улучшения нет", !two || (!g.buyUpgrade("player", two, "strip") && two.kind === null));
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

// ---------- улучшенная точка: берётся дольше и достаётся захватчику ----------
{
  function grabTime(kind) {
    const g = loadGame();
    g.reset(1);
    const b = g.businesses.find(x => x.owner === "neutral" && g.captureSpots(x).length);
    b.kind = kind;                                   // ничья точка с уже готовым заведением
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

// ---------- панель улучшений ----------
{
  const g = loadGame();
  g.reset(1);
  g.money = 5000; g.update(0.001);
  ok("панель: без выбора кнопки улучшений выключены", g.els.buyUpBar.disabled === true);
  ok("панель: цена улучшения на месте", g.els.costUpBar.textContent === "$" + g.UPGRADES.bar.cost,
    g.els.costUpBar.textContent);
  g.selBiz = g.playerHQ(); g.update(0.001);
  ok("панель: штаб улучшать не даёт",
    g.els.buyUpBar.disabled === true && /Штаб/.test(g.els.upSel.textContent), g.els.upSel.textContent);
  const mine = g.businesses.find(b => b.owner === "player" && !b.hq);
  g.selBiz = mine; g.update(0.001);
  ok("панель: своя точка включает кнопки", g.els.buyUpBar.disabled === false);
  ok("панель: рынок показывает свою долю и размер",
    /Бар: <b[^>]*>0%<\/b> · рынок 10/.test(g.els.market.innerHTML), g.els.market.innerHTML);
  g.playerUpgrade("strip"); g.update(0.001);
  ok("панель: после улучшения кнопки гаснут", g.els.buyUpBar.disabled === true && mine.kind === "strip");
  ok("панель: доля в целых процентах",
    /Стриптиз: <b[^>]*>10%<\/b> · рынок 10/.test(g.els.market.innerHTML), g.els.market.innerHTML);
  // потеря точки снимает выбор сама, без отдельного хука в захвате
  mine.owner = "ai1"; g.update(0.001);
  ok("панель: потерянная точка снимает выбор", g.selBiz === null);
}

console.log(fails ? `\nПРОВАЛЕНО проверок: ${fails}` : "\nвсе проверки пройдены");
process.exit(fails ? 1 : 0);
