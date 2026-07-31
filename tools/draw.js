// Дымовой тест рендера: гоняет update+draw и ловит исключения в отрисовке.
// Логика и рендер живут в одном файле, поэтому правка в одном легко ломает другое.
//   node tools/draw.js [кадров]
const { loadGame } = require("./harness");

const FRAMES = +(process.argv[2] || 1400);
const g = loadGame();

for (let i = 0; i < FRAMES * 0.85; i++) { g.update(0.05); g.draw(); }
// повтор с выделенными юнитами: кольца выделения и рамка — отдельные ветки рендера
g.units.slice(0, 3).forEach(u => g.selected.add(u.id));
// и с улучшенными заведениями: иконки типов, подпись и рамка выбранной точки
g.UP_KEYS.forEach((k, i) => { const b = g.businesses[i * 2]; if (b && !b.hq) b.kind = k; });
g.selBiz = g.businesses.find(b => b.owner === "player" && !b.hq) || null;
for (let i = 0; i < FRAMES * 0.15; i++) { g.update(0.05); g.draw(); }

console.log(`draw OK: ${FRAMES} кадров без ошибок, юнитов: ${g.units.length}, ` +
  `бизнесов у игрока: ${g.businesses.filter(b => b.owner === "player").length}/${g.businesses.length}`);
