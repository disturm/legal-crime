// Дымовой тест рендера и звука: гоняет update+draw+musicTick и ловит исключения.
// Логика, рендер и звук живут в одном файле, поэтому правка в одном легко ломает другое.
//   node tools/draw.js [кадров]
const { loadGame } = require("./harness");

const FRAMES = +(process.argv[2] || 1400);
// Звук живёт в том же файле и ломается так же легко, как рендер: гоняем его теми же кадрами.
// Заглушка WebAudio + ручной шаг планировщика — время в песочнице само не идёт.
const g = loadGame(1200, 800, { audio: true });
g.audioInit();
let voices = 0;
function frame() {
  g.update(0.05); g.draw();
  g.actx.currentTime += 0.05;   // выстрелы считают бюджет голосов, музыка — горизонт нот
  g.musicTick();
  voices += g.audioLog.voices; g.audioLog.reset();
}

// Несколько сидов: рельеф случаен, и на одной карте канал, парк или мост могут просто
// не попасть в кадр — тогда их ветки отрисовки останутся непроверенными.
const SEEDS = [1007, 4007, 8007, 12007];
const per = Math.max(1, Math.floor(FRAMES / SEEDS.length));

SEEDS.forEach((seed, si) => {
  g.reset(si === SEEDS.length - 1 ? 3 : 2, seed);   // последний прогон — на трёх ИИ
  for (let i = 0; i < per * 0.85; i++) frame();
  // по бойцу каждого класса: силуэт, оружие и звук выстрела — отдельные ветки, а ИИ
  // за партию может так и не открыть дорогой класс, и его ветка осталась бы непроверенной
  const sp = g.captureSpots(g.playerHQ())[0];
  if (sp) Object.keys(g.TYPES).forEach((t, i) => g.spawnUnit(t, sp.x + i * 6, sp.y, "player"));
  // повтор с выделенными юнитами: кольца выделения и рамка — отдельные ветки рендера
  g.units.slice(0, 3).forEach(u => g.selected.add(u.id));
  // и с улучшенными заведениями: иконки типов, подпись и рамка выбранной точки
  g.UP_KEYS.forEach((k, i) => { const b = g.businesses[i * 2]; if (b && !b.hq) b.kind = k; });
  g.selBiz = g.businesses.find(b => b.owner === "player" && !b.hq) || null;
  for (let i = 0; i < per * 0.15; i++) frame();
});

console.log(`draw OK: ${per * SEEDS.length} кадров на ${SEEDS.length} картах без ошибок, ` +
  `юнитов: ${g.units.length}, бизнесов у игрока: ` +
  `${g.businesses.filter(b => b.owner === "player").length}/${g.businesses.length}, ` +
  `звуковых голосов: ${voices}`);
