// Загружает игровой скрипт из legal-crime.html в песочницу Node с заглушками DOM/canvas.
// Нужен потому, что превью-панель браузера держит статический снапшот и не
// перезагружает страницу — проверять правки в ней нельзя.
const fs = require("fs"), vm = require("vm"), path = require("path");

const GAME = path.join(__dirname, "..", "legal-crime.html");

// Верхнеуровневые const/let НЕ попадают в объект песочницы (они в скоупе скрипта),
// поэтому дописываем мост через геттеры — иначе из теста ничего не видно.
const BRIDGE = `
;var api = {
  get units(){return units}, get businesses(){return businesses},
  get selected(){return selected}, get cam(){return cam}, get bullets(){return bullets},
  get money(){return funds.player}, set money(v){funds.player=v},   // контракт tools/: g.money — кошелёк игрока
  get selBiz(){return selBiz}, set selBiz(v){selBiz=v},
  get ended(){return ended}, get wave(){return wave},
  get outcome(){return outcome}, get factions(){return factions},
  set W(v){W=v}, set H(v){H=v},
  TYPES, TEAM, grid, TILE, COLS, ROWS, WORLD_W, WORLD_H, unlocks,
  T, walkableT, opaqueT, buildableT, inMap, blocksSight, nextToWalk,
  buildings, blocks, roadCols, roadRows, isRoadCol, isRoadRow,
  get mapSeed(){return mapSeed},
  genMap, buildTerrain, validateTerrain, validateBiz, landComponents, bizSpots, placeBiz,
  distFrom, stepsTo, enemyAI,
  update, draw, setDest, spawnUnit, passable, findPath,
  hasLOS, reset: initWorld, playerHQ, factionHQ,
  selectBuy, captureSpots, inCapZone, captureBusinesses, fire, commandTo, pickBiz,
  vis, canSee, knownOwner, bizView, updateVision, visFrom,
  funds, fInc, fUp, tickEconomy,
  UPGRADES, UP_KEYS, MARKET_MIN, aiFavor, CAP_UPGRADED,
  marketCount, marketSize, marketPct, bizIncome, bizIncomeOf, bizBaseIncome, upIncomeAt,
  canUpgrade, buyUpgrade, playerUpgrade, aiUpgrade
};`;

function stubCtx() {
  const noop = () => {};
  return new Proxy({}, { get: (t, k) => (k === "canvas" ? {} : noop), set: () => true });
}
function makeEl() {
  return {
    style: {}, textContent: "", disabled: false, checked: false, onclick: null, onchange: null,
    addEventListener: () => {}, getContext: () => stubCtx(),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 1200, bottom: 800, width: 1200, height: 800 }),
    clientWidth: 1200, clientHeight: 800, width: 1200, height: 800,
  };
}

// Возвращает api загруженной партии. Каждый вызов — новый мир со своей картой.
function loadGame(w = 1200, h = 800) {
  const html = fs.readFileSync(GAME, "utf8");
  const code = html.match(/<script>([\s\S]*)<\/script>/)[1] + BRIDGE;
  const els = {};
  const sandbox = {
    document: { getElementById: id => (els[id] = els[id] || makeEl()) },
    ResizeObserver: class { observe() {} },
    performance: { now: () => 0 },
    requestAnimationFrame: () => {},
    addEventListener: () => {},
    location: { reload: () => {} },
    console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.api.W = w; sandbox.api.H = h;   // ResizeObserver в Node не срабатывает
  sandbox.api.els = els;                  // заглушки панели: по ним видно, что показано игроку
  return sandbox.api;
}

module.exports = { loadGame, GAME };
