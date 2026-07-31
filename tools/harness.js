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
  get selBiz(){return selBiz}, set selBiz(v){selBiz=v}, setSelBiz,
  w2s, s2w, placeBizPanel, mmRect, BIZ_PANEL_W, BIZ_PANEL_H,
  get ended(){return ended}, get wave(){return wave},
  get outcome(){return outcome}, get factions(){return factions},
  set W(v){W=v}, set H(v){H=v},
  TYPES, BUY_KEYS, AI_BRIBE, TEAM, grid, TILE, COLS, ROWS, WORLD_W, WORLD_H, unlocks,
  T, walkableT, opaqueT, buildableT, inMap, blocksSight, nextToWalk,
  buildings, blocks, roadCols, roadRows, isRoadCol, isRoadRow,
  get mapSeed(){return mapSeed},
  genMap, buildTerrain, validateTerrain, validateBiz, landComponents, bizSpots, placeBiz,
  distFrom, stepsTo, enemyAI,
  update, draw, setDest, spawnUnit, passable, findPath,
  hasLOS, reset: initWorld, playerHQ, factionHQ,
  selectBuy, captureSpots, inCapZone, captureBusinesses, fire, commandTo, pickBiz,
  vis, canSee, knownOwner, bizView, updateVision, visFrom, SIGHT_BIZ, SIGHT_HQ,
  funds, fInc, fUp, tickEconomy,
  UPGRADES, UP_KEYS, MARKET_KEYS, MARKET_MIN, aiFavor, CAP_UPGRADED,
  marketCount, marketSize, marketPct, bizIncome, bizIncomeOf, bizBaseIncome, bizTag, upIncomeAt,
  bizUpkeep, rally, canRally, setRally, rallyPoint, resetRally, playerRally,
  canUpgrade, buyUpgrade, playerUpgrade, aiUpgrade,
  canDemolish, demolish, playerDemolish, aiSwap, AI_SWAP_GAIN,
  get musicOn(){return musicOn}, get sfxOn(){return sfxOn},
  get actx(){return actx},   // в тесте им двигают currentTime: бюджет голосов и планировщик считают по нему
  SHOTS, sfx, setAudio, toggleMute, audioInit, audioResume, audioDuck,
  musicTick, musicStart, musicStop, syncAudioUI
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

// Заглушка WebAudio — по образцу заглушки канваса, но ЗАПИСЫВАЮЩАЯ: по ней видно,
// сколько голосов завёл звук и из каких узлов он собран. В Node AudioContext нет,
// а звуковой код обязан прогоняться тестами так же, как рендер.
// Новый тип узла в игре — дописать сюда, иначе тест упадёт на undefined.
function audioStub(log) {
  // Параметр помнит, что в него писали: по этому следу видно, что вышибала, стрелок
  // и снайпер звучат по-разному, а не одним и тем же узлом с другим именем.
  const param = v => ({
    value: v, log: [],
    set(x) { this.value = x; this.log.push(Math.round(x * 10) / 10); return this; },
    setValueAtTime(x) { return this.set(x); },
    linearRampToValueAtTime(x) { return this.set(x); },
    exponentialRampToValueAtTime(x) { return this.set(x); },
    setTargetAtTime(x) { return this.set(x); },
    cancelScheduledValues() { return this; },
  });
  const node = (kind, extra) => {
    const n = Object.assign({ kind, connect(to) { return to; }, disconnect() {} }, extra || {});
    log.nodes.push(kind); log.made.push(n);
    return n;
  };
  const src = extra => node(extra.kind, Object.assign({
    start() { log.voices++; }, stop() {},
  }, extra));
  return class AudioContextStub {
    constructor() {
      this.currentTime = 0; this.sampleRate = 44100; this.state = "running";
      this.destination = node("dest");
    }
    resume() { this.state = "running"; }
    createGain() { return node("gain", { gain: param(1) }); }
    createBiquadFilter() { return node("filter", { type: "lowpass", frequency: param(1e3), Q: param(1), gain: param(0) }); }
    createStereoPanner() { return node("pan", { pan: param(0) }); }
    createDynamicsCompressor() {
      return node("comp", { threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0), release: param(0) });
    }
    createOscillator() { return src({ kind: "osc", type: "sine", frequency: param(440), detune: param(0) }); }
    createBufferSource() { return src({ kind: "noise", buffer: null, loop: false }); }
    createBuffer(ch, len) { return { numberOfChannels: ch, length: len, getChannelData: () => new Float32Array(len) }; }
  };
}

// Возвращает api загруженной партии. Каждый вызов — новый мир со своей картой.
// opts.audio — подсунуть заглушку WebAudio. По умолчанию её НЕТ: так проверяется,
// что игра живёт вообще без AudioContext, и sim.js не платит за звук на каждом выстреле.
function loadGame(w = 1200, h = 800, opts = {}) {
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
  const log = {
    voices: 0, nodes: [], made: [],
    reset() { this.voices = 0; this.nodes.length = 0; this.made.length = 0; },
    // подпись звука: узлы с типом фильтра/осциллятора и следом по частоте
    sig() {
      return this.made.map(n => {
        const f = n.frequency;
        const hz = !f ? "" : (f.log.length ? f.log.join(">") : f.value);
        return [n.kind, n.type || "", hz].filter(Boolean).join(":");
      }).join(" ");
    },
  };
  if (opts.audio) {
    sandbox.AudioContext = audioStub(log);
    // Планировщик музыки не должен тикать сам по себе: тест зовёт musicTick вручную,
    // иначе число нот зависело бы от того, сколько шёл сам тест.
    sandbox.setInterval = () => 1;
    sandbox.clearInterval = () => {};
  }
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.api.W = w; sandbox.api.H = h;   // ResizeObserver в Node не срабатывает
  sandbox.api.els = els;                  // заглушки панели: по ним видно, что показано игроку
  sandbox.api.audioLog = log;             // счётчик голосов звуковой заглушки
  return sandbox.api;
}

module.exports = { loadGame, GAME };
