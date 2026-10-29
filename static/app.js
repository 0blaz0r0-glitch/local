"use strict";

const $ = (id) => document.getElementById(id);

function setBadge(text, cls) {
  const b = $("status-badge");
  b.textContent = text;
  b.className = "badge " + cls;
}

function show(el, html, ok) {
  el.classList.remove("hidden", "ok", "err");
  el.innerHTML = html;
  el.classList.add(ok ? "ok" : "err");
}

// Измеряет время запроса к /api/ping
async function timedPing() {
  const t0 = performance.now();
  const resp = await fetch("/api/ping?_=" + Date.now(), { cache: "no-store" });
  const data = await resp.json();
  const latency = performance.now() - t0;
  return { latency, data };
}

// ===== 1. Быстрый ping =====
$("btn-ping").addEventListener("click", async () => {
  const btn = $("btn-ping");
  btn.disabled = true;
  try {
    const { latency, data } = await timedPing();
    setBadge("Онлайн · " + latency.toFixed(1) + " мс", "badge-ok");
    show($("ping-result"),
      `✅ Сервер отвечает!<br>` +
      `Задержка: <b>${latency.toFixed(1)} мс</b><br>` +
      `Время сервера: ${data.time}<br>` +
      `Ваш IP (со стороны сервера): ${data.client_ip}`, true);
  } catch (e) {
    setBadge("Нет соединения", "badge-err");
    show($("ping-result"), `❌ Сервер недоступен: ${e.message}`, false);
  } finally {
    btn.disabled = false;
  }
});

// ===== 2. Мониторинг =====
let monitorTimer = null;
const samples = []; // {latency|null, ok}
const MAX_SAMPLES = 60;

function drawChart() {
  const c = $("chart");
  const ctx = c.getContext("2d");
  const W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);

  // сетка
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const y = (H / 4) * i;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  if (!samples.length) return;

  const lats = samples.filter(s => s.ok).map(s => s.latency);
  const maxLat = Math.max(...lats, 10);

  // линия задержки
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  samples.forEach((s, i) => {
    const x = (i / (MAX_SAMPLES - 1)) * W;
    if (s.ok) {
      const y = H - (s.latency / maxLat) * (H - 10) - 5;
      if (i === 0 || !samples[i - 1].ok) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // точки ошибок (красным снизу)
  samples.forEach((s, i) => {
    const x = (i / (MAX_SAMPLES - 1)) * W;
    if (!s.ok) {
      ctx.fillStyle = "#f87171";
      ctx.fillRect(x - 2, H - 8, 4, 6);
    }
  });

  // подпись макс. задержки
  ctx.fillStyle = "#94a3b8";
  ctx.font = "11px sans-serif";
  ctx.fillText(maxLat.toFixed(0) + " мс", 4, 12);
}

function updateStats() {
  const total = samples.length;
  const okSamples = samples.filter(s => s.ok);
  $("monitor-stats").classList.remove("hidden");
  $("stat-last").textContent = okSamples.length
    ? okSamples[okSamples.length - 1].latency.toFixed(1) + " мс" : "—";
  const avg = okSamples.reduce((a, s) => a + s.latency, 0) / (okSamples.length || 1);
  $("stat-avg").textContent = okSamples.length ? avg.toFixed(1) + " мс" : "—";
  const max = okSamples.reduce((a, s) => Math.max(a, s.latency), 0);
  $("stat-max").textContent = okSamples.length ? max.toFixed(1) + " мс" : "—";
  $("stat-ok").textContent = `${okSamples.length} / ${total}` +
    (total ? ` (${Math.round(okSamples.length / total * 100)}%)` : "");
}

async function monitorTick() {
  try {
    const { latency } = await timedPing();
    samples.push({ latency, ok: true });
    setBadge("Мониторинг · " + latency.toFixed(1) + " мс", "badge-ok");
  } catch (e) {
    samples.push({ latency: null, ok: false });
    setBadge("Мониторинг · потеря пакета", "badge-err");
  }
  if (samples.length > MAX_SAMPLES) samples.shift();
  drawChart();
  updateStats();
}

$("btn-monitor").addEventListener("click", () => {
  const btn = $("btn-monitor");
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    btn.textContent = "▶ Запустить мониторинг";
  } else {
    monitorTick();
    monitorTimer = setInterval(monitorTick, 2000);
    btn.textContent = "⏹ Остановить мониторинг";
  }
});

// ===== 3. Информация о сервере =====
$("btn-info").addEventListener("click", async () => {
  const btn = $("btn-info");
  btn.disabled = true;
  const el = $("info-result");
  try {
    const resp = await fetch("/api/info?_=" + Date.now(), { cache: "no-store" });
    const info = await resp.json();
    el.classList.remove("hidden", "err");
    el.classList.add("ok");
    el.textContent = JSON.stringify(info, null, 2);
  } catch (e) {
    show(el, "❌ Ошибка: " + e.message, false);
  } finally {
    btn.disabled = false;
  }
});

// ===== 4. Тест скорости =====
function fmtBytes(b) {
  if (b > 1048576) return (b / 1048576).toFixed(2) + " МБ";
  return (b / 1024).toFixed(1) + " КБ";
}

$("btn-speed").addEventListener("click", async () => {
  const btn = $("btn-speed");
  btn.disabled = true;
  const size = parseInt($("dl-size").value, 10);
  const el = $("speed-result");
  try {
    const t0 = performance.now();
    const resp = await fetch(`/api/download?size=${size}&_=${Date.now()}`, { cache: "no-store" });
    const blob = await resp.blob();
    const secs = (performance.now() - t0) / 1000;
    const bytes = blob.size;
    const mbps = (bytes * 8) / secs / 1e6;
    show(el,
      `📥 Загружено: <b>${fmtBytes(bytes)}</b> за <b>${secs.toFixed(3)} с</b><br>` +
      `Скорость канала: <b>${mbps.toFixed(1)} Мбит/с</b> (${(bytes / 1024 / secs).toFixed(0)} КБ/с)`,
      true);
  } catch (e) {
    show(el, "❌ Ошибка: " + e.message, false);
  } finally {
    btn.disabled = false;
  }
});

// ===== 5. Проверка другого хоста =====
$("btn-probe").addEventListener("click", async () => {
  const btn = $("btn-probe");
  const host = $("probe-host").value.trim();
  const port = $("probe-port").value.trim();
  const el = $("probe-result");
  if (!host) {
    show(el, "⚠️ Укажите IP или имя хоста", false);
    return;
  }
  btn.disabled = true;
  try {
    const resp = await fetch(`/api/probe?host=${encodeURIComponent(host)}&port=${port}`,
                             { cache: "no-store" });
    const data = await resp.json();
    if (data.reachable) {
      show(el, `✅ Хост <b>${host}:${port}</b> доступен (отклик ${data.time_ms.toFixed(1)} мс)`, true);
    } else {
      show(el, `❌ Хост <b>${host}:${port}</b> недоступен: ${data.error}`, false);
    }
  } catch (e) {
    show(el, "❌ Ошибка запроса: " + e.message, false);
  } finally {
    btn.disabled = false;
  }
});

// Автопроверка при загрузке страницы
window.addEventListener("load", async () => {
  try {
    const { latency } = await timedPing();
    setBadge("Сервер онлайн · " + latency.toFixed(1) + " мс", "badge-ok");
  } catch (e) {
    setBadge("Сервер недоступен", "badge-err");
  }
});
