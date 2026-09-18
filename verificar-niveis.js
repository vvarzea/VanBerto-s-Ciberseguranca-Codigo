#!/usr/bin/env node
/**
 * verificar-niveis.js
 * ────────────────────
 * Ferramenta de verificação para o jogo "Missão Cibersegurança — Programação!".
 *
 * O QUE FAZ:
 *   1. Lê o ficheiro index.html do jogo.
 *   2. Extrai os dados de GAME_DATA (todos os níveis) e QUIZ_DATA (perguntas).
 *   3. Para cada nível, corre o MESMO algoritmo de busca (BFS) que o jogo usa
 *      para confirmar que é mesmo possível resolvê-lo, e regista quantas
 *      ações (movimentos + viragens + apanhar/depositar) a solução ótima
 *      precisa.
 *   4. Verifica erros estruturais óbvios: coordenadas fora da grelha,
 *      obstáculos a sobrepor o robô/itens/depósito, obstáculos duplicados.
 *   5. Verifica se alguma solução ótima excede o limite interno do jogo
 *      (hoje 180 ações — ver MOVE_CAP abaixo) — se exceder, o jogo mostra
 *      "🏁 Ótimo: —" para sempre nesse nível e a 3ª estrela fica impossível.
 *   6. Verifica as perguntas do quiz (QUIZ_DATA): pergunta não vazia, pelo
 *      menos 2 opções, índice da resposta certa dentro do intervalo.
 *
 * COMO USAR:
 *   node verificar-niveis.js                  (assume "./index.html")
 *   node verificar-niveis.js caminho/para/index.html
 *
 * QUANDO USAR:
 *   Sempre que adicionares, editares ou apagares um nível ou uma pergunta
 *   à mão no ficheiro do jogo. Não precisa de internet nem de instalar nada
 *   — só precisa de Node.js instalado no computador.
 *
 * IMPORTANTE se um dia mudares o limite de ações no jogo:
 *   Procura por "cur.moves>180" dentro do <script> do index.html (aparece
 *   duas vezes, dentro de bfsOptimal e bfsOptimalAsync) e atualiza também
 *   o MOVE_CAP aqui em baixo para o mesmo valor, para os dois lados
 *   continuarem de acordo.
 */

const fs = require("fs");
const path = require("path");

const MOVE_CAP = 180; // manter igual ao "cur.moves>180" do index.html

const filePath = process.argv[2] || "./index.html";
if (!fs.existsSync(filePath)) {
  console.error(`❌ Não encontrei o ficheiro: ${filePath}`);
  console.error(`   Uso: node verificar-niveis.js caminho/para/index.html`);
  process.exit(1);
}
const html = fs.readFileSync(filePath, "utf-8");

function extractBlock(html, startMarker) {
  const startIdx = html.indexOf(startMarker);
  if (startIdx === -1) return null;
  // Conta chavetas a partir da primeira "{" depois do marcador, para
  // encontrar exatamente onde o objeto fecha, mesmo com strings/regex lá
  // dentro que contenham chavetas dentro de aspas (não devia acontecer
  // nos dados deste jogo, mas jogamos pelo seguro).
  let i = html.indexOf("{", startIdx);
  if (i === -1) return null;
  let depth = 0, inStr = null, esc = false;
  for (let j = i; j < html.length; j++) {
    const ch = html[j];
    if (inStr) {
      if (esc) { esc = false; }
      else if (ch === "\\") { esc = true; }
      else if (ch === inStr) { inStr = null; }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return html.slice(i, j + 1);
    }
  }
  return null;
}

function loadDataObject(html, marker, label) {
  const objText = extractBlock(html, marker);
  if (!objText) {
    console.error(`❌ Não consegui encontrar "${marker}" no ficheiro — o formato do jogo pode ter mudado.`);
    process.exit(1);
  }
  try {
    // eslint-disable-next-line no-new-func
    return Function(`"use strict"; return (${objText});`)();
  } catch (e) {
    console.error(`❌ Erro a interpretar ${label}:`, e.message);
    process.exit(1);
  }
}

const GAME_DATA = loadDataObject(html, "const GAME_DATA = {", "GAME_DATA");
const QUIZ_DATA = loadDataObject(html, "const QUIZ_DATA={", "QUIZ_DATA")
  || loadDataObject(html, "const QUIZ_DATA = {", "QUIZ_DATA");

/* ===== Mesmo algoritmo de busca (BFS) do jogo ===== */
function computeDoorPos(base) {
  const s = base.size, dep = base.deposit[0] || [0, 0], rob = base.robot;
  const corners = [[0, 0], [0, s - 1], [s - 1, 0], [s - 1, s - 1]];
  const obs = base.obstacles || [];
  const free = corners.filter(([r, c]) => {
    if (obs.some(o => o[0] === r && o[1] === c)) return false;
    if (dep[0] === r && dep[1] === c) return false;
    if (rob[0] === r && rob[1] === c) return false;
    return true;
  });
  const pool = free.length ? free : corners;
  return pool.reduce((best, p) => {
    const d = Math.abs(p[0] - dep[0]) + Math.abs(p[1] - dep[1]);
    const bd = Math.abs(best[0] - dep[0]) + Math.abs(best[1] - dep[1]);
    return d > bd ? p : best;
  }, pool[0]);
}

function bfsOptimal(base, door) {
  door = door || computeDoorPos(base);
  const s = base.size;
  const isObs = (r, c) => (base.obstacles || []).some(o => o[0] === r && o[1] === c);
  const dep = door;
  const stKey = (rob, d, items, carry) =>
    rob[0] + "," + rob[1] + "," + d + "," + (carry ? 1 : 0) + "|" +
    items.filter(i => !i.collected).map(i => i.r + "," + i.c).sort().join(";");
  const items0 = base.items.map(([r, c]) => ({ r, c, collected: false }));
  const start = { rob: [...base.robot], d: 0, items: items0, carry: false, moves: 0 };
  const visited = new Set([stKey(start.rob, start.d, start.items, start.carry)]);
  const queue = [start];
  const DR = [[-1, 0], [0, 1], [1, 0], [0, -1]];
  let best = null, iterations = 0;
  const MAX_ITER = 2000000;
  while (queue.length) {
    iterations++;
    if (iterations > MAX_ITER) return { best: null, timedOut: true };
    const cur = queue.shift();
    if (best !== null && cur.moves >= best) continue;
    const remaining = cur.items.filter(i => !i.collected);
    const [rr, rc] = cur.rob;
    if (remaining.length === 0 && !cur.carry && rr === door[0] && rc === door[1]) { best = cur.moves; continue; }
    const [fdr, fdc] = DR[cur.d];
    const [fr, fc] = [rr + fdr, rc + fdc];
    if (fr >= 0 && fr < s && fc >= 0 && fc < s && !isObs(fr, fc)) {
      const sk = stKey([fr, fc], cur.d, cur.items, cur.carry);
      if (!visited.has(sk)) { visited.add(sk); queue.push({ rob: [fr, fc], d: cur.d, items: cur.items.map(i => ({ ...i })), carry: cur.carry, moves: cur.moves + 1 }); }
    }
    const dl = (cur.d + 3) % 4;
    const skl = stKey(cur.rob, dl, cur.items, cur.carry);
    if (!visited.has(skl)) { visited.add(skl); queue.push({ rob: [...cur.rob], d: dl, items: cur.items.map(i => ({ ...i })), carry: cur.carry, moves: cur.moves + 1 }); }
    const dr2 = (cur.d + 1) % 4;
    const skr = stKey(cur.rob, dr2, cur.items, cur.carry);
    if (!visited.has(skr)) { visited.add(skr); queue.push({ rob: [...cur.rob], d: dr2, items: cur.items.map(i => ({ ...i })), carry: cur.carry, moves: cur.moves + 1 }); }
    if (!cur.carry) {
      const idx = cur.items.findIndex(i => !i.collected && i.r === rr && i.c === rc);
      if (idx >= 0) {
        const ni = cur.items.map(i => ({ ...i })); ni[idx].collected = true;
        const sk = stKey(cur.rob, cur.d, ni, true);
        if (!visited.has(sk)) { visited.add(sk); queue.push({ rob: [...cur.rob], d: cur.d, items: ni, carry: true, moves: cur.moves + 1 }); }
      }
    }
    if (cur.carry && rr === dep[0] && rc === dep[1]) {
      const sk = stKey(cur.rob, cur.d, cur.items, false);
      if (!visited.has(sk)) { visited.add(sk); queue.push({ rob: [...cur.rob], d: cur.d, items: cur.items.map(i => ({ ...i })), carry: false, moves: cur.moves + 1 }); }
    }
  }
  return { best, timedOut: false };
}

/* ===== Verificações ===== */
let totalLevels = 0, errors = 0, warnings = 0;

function checkLevel(ck, tk, listName, idx, lv) {
  totalLevels++;
  const label = `${ck}/${tk}/${listName}[${idx}]`;
  const s = lv.size;
  const inBounds = (r, c, tag) => {
    if (r < 0 || r >= s || c < 0 || c >= s) {
      console.log(`ERRO  ${label}: ${tag} (${r},${c}) fora da grelha (size=${s})`);
      errors++;
    }
  };
  inBounds(lv.robot[0], lv.robot[1], "robot");
  if (!lv.deposit || lv.deposit.length !== 1) {
    console.log(`ERRO  ${label}: "deposit" deve ter exatamente 1 posição`);
    errors++;
  } else {
    inBounds(lv.deposit[0][0], lv.deposit[0][1], "deposit");
  }
  if (!lv.items || lv.items.length === 0) {
    console.log(`ERRO  ${label}: sem itens`);
    errors++;
  }
  (lv.items || []).forEach(([r, c], i) => inBounds(r, c, "item" + i));
  (lv.obstacles || []).forEach(([r, c], i) => inBounds(r, c, "obstacle" + i));

  const obsKeys = (lv.obstacles || []).map(([r, c]) => r + "," + c);
  const obsSet = new Set(obsKeys);
  const seen = new Set();
  obsKeys.forEach(k => {
    if (seen.has(k)) { console.log(`AVISO ${label}: obstáculo duplicado (${k})`); warnings++; }
    seen.add(k);
  });
  const robotKey = lv.robot[0] + "," + lv.robot[1];
  if (obsSet.has(robotKey)) { console.log(`ERRO  ${label}: robô começa sobre um obstáculo (${robotKey})`); errors++; }
  (lv.items || []).forEach(([r, c], i) => {
    if (obsSet.has(r + "," + c)) { console.log(`ERRO  ${label}: item${i} sobre um obstáculo (${r},${c})`); errors++; }
  });
  // Nota: "deposit" sobre um obstáculo NÃO é erro — esse campo é só uma
  // referência de distância para calcular o canto do portal (doorPos),
  // nunca é o sítio real de entrega. Ver comentário junto a
  // computeDoorPos() no index.html.

  const door = computeDoorPos(lv);
  const { best, timedOut } = bfsOptimal(lv, door);
  if (timedOut) {
    console.log(`AVISO ${label}: BFS excedeu o limite de iterações — não foi possível confirmar`);
    warnings++;
  } else if (best === null) {
    console.log(`ERRO  ${label}: NÍVEL IMPOSSÍVEL — nenhuma sequência de ações resolve este nível (door=${JSON.stringify(door)})`);
    errors++;
  } else if (best > MOVE_CAP) {
    console.log(`AVISO ${label}: solução ótima precisa de ${best} ações — passa o limite do jogo (${MOVE_CAP}); "Ótimo" vai ficar sempre em "—" e a 3ª estrela fica impossível`);
    warnings++;
  }
}

Object.keys(GAME_DATA).forEach(ck => {
  const cycle = GAME_DATA[ck];
  Object.keys(cycle.themes).forEach(tk => {
    const theme = cycle.themes[tk];
    (theme.levels || []).forEach((lv, idx) => checkLevel(ck, tk, "levels", idx, lv));
    (theme.superEasyLevels || []).forEach((lv, idx) => checkLevel(ck, tk, "superEasyLevels", idx, lv));
  });
});

let totalQ = 0, quizErrors = 0;
if (QUIZ_DATA) {
  Object.keys(QUIZ_DATA).forEach(key => {
    const arr = QUIZ_DATA[key];
    if (!Array.isArray(arr)) return;
    arr.forEach((item, idx) => {
      totalQ++;
      const label = `quiz/${key}[${idx}]`;
      if (typeof item.q !== "string" || !item.q.trim()) {
        console.log(`ERRO  ${label}: pergunta vazia/inválida`); quizErrors++;
      }
      if (!Array.isArray(item.ops) || item.ops.length < 2) {
        console.log(`ERRO  ${label}: precisa de pelo menos 2 opções`); quizErrors++;
      }
      if (typeof item.a !== "number" || item.a < 0 || (item.ops && item.a >= item.ops.length)) {
        console.log(`ERRO  ${label}: índice da resposta certa (a=${item.a}) fora do intervalo de opções`); quizErrors++;
      }
    });
  });
} else {
  console.log("AVISO: não encontrei QUIZ_DATA — perguntas do quiz não verificadas.");
}

console.log("\n=== RESUMO ===");
console.log(`Níveis verificados: ${totalLevels}  |  Erros: ${errors}  |  Avisos: ${warnings}`);
if (QUIZ_DATA) console.log(`Perguntas verificadas: ${totalQ}  |  Erros: ${quizErrors}`);
if (errors === 0 && quizErrors === 0) {
  console.log("\n✅ Tudo em ordem — todos os níveis são possíveis e o quiz está bem formado.");
} else {
  console.log("\n⚠️  Há problemas por corrigir — ver detalhes acima.");
}
process.exit(errors > 0 || quizErrors > 0 ? 1 : 0);
