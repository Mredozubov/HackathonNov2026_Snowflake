import {advance, currentDay, events, newGame, portfolio, prices, startingCash, years} from "./replay-engine.mjs?v=long-replay";

const byId = id => document.getElementById(id);
const canvas = byId("chart");
const form = byId("trade");
const action = byId("action");
const shares = byId("shares");
const usd = new Intl.NumberFormat("en-US", {style:"currency", currency:"USD"});
const money = cents => usd.format(cents / 100);
const shortFormat = new Intl.DateTimeFormat("en-US", {month:"short", day:"numeric", timeZone:"UTC"});
const fullFormat = new Intl.DateTimeFormat("en-US", {month:"short", day:"numeric", year:"numeric", timeZone:"UTC"});
const shortDate = value => shortFormat.format(new Date(value + "T00:00:00Z"));
const fullDate = value => fullFormat.format(new Date(value + "T00:00:00Z"));
let game = newGame();
let animationFrame = null;
let playhead = currentDay(game);
let inspectedDay = null;
let chartRange;
const chartDetail = byId("chart-detail");

function drawChart() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (width < 1 || height < 1) return;
  const scale = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  context.scale(scale, scale);
  const day = Math.floor(playhead);
  const year = prices[day].date.slice(0, 4);
  const start = years.get(year).start;
  const visible = prices.slice(start, day + 1);
  const values = visible.map(point => point.cents / 100);
  const fraction = playhead - day;
  const last = values.at(-1);
  const tip = fraction ? last + (prices[day + 1].cents / 100 - last) * fraction : last;
  const minimum = Math.min(...values, tip);
  const maximum = Math.max(...values, tip);
  const padding = Math.max(4, (maximum - minimum) * .12);
  const low = minimum - padding;
  const high = maximum + padding;
  const plot = {left:53, right:width - 15, top:12, bottom:height - 28};
  const span = Math.max(1, playhead - start);
  const x = index => plot.left + (plot.right - plot.left) * (index - start) / span;
  chartRange = {start, day, span, left:plot.left, right:plot.right};
  const y = value => plot.bottom - (plot.bottom - plot.top) * (value - low) / (high - low);
  context.font = "14px system-ui";
  context.fillStyle = "#50627d";
  context.strokeStyle = "#dce4f1";
  const desiredStep = (high - low) / Math.max(2, Math.floor((plot.bottom - plot.top) / 31));
  const magnitude = 10 ** Math.floor(Math.log10(desiredStep));
  const tickSize = [1, 2, 5, 10].find(step => step * magnitude >= desiredStep) * magnitude;
  for (let tick = Math.ceil(low / tickSize) * tickSize; tick <= high; tick += tickSize) {
    const lineY = y(tick);
    context.beginPath();
    context.moveTo(plot.left, lineY);
    context.lineTo(plot.right, lineY);
    context.stroke();
    context.fillText("$" + tick, 0, lineY + 4);
  }
  const labels = Math.min(visible.length, width < 520 ? 3 : 6);
  for (let i = 0; i < labels; i++) {
    const index = Math.floor((day - start) * i / Math.max(1, labels - 1));
    context.textAlign = i === 0 ? "left" : i === labels - 1 ? "right" : "center";
    context.fillText(shortDate(visible[index].date), x(start + index), height - 8);
  }
  function trace() {
    context.beginPath();
    context.moveTo(x(start), y(values[0]));
    values.slice(1).forEach((value, index) => context.lineTo(x(start + index + 1), y(value)));
    if (fraction) context.lineTo(x(playhead), y(tip));
  }
  trace();
  context.lineTo(x(playhead), plot.bottom);
  context.lineTo(plot.left, plot.bottom);
  context.closePath();
  const fill = context.createLinearGradient(0, plot.top, 0, plot.bottom);
  fill.addColorStop(0, "#d2e0ff");
  fill.addColorStop(1, "#f5f8ff");
  context.fillStyle = fill;
  context.fill();
  trace();
  context.strokeStyle = "#2457dc";
  context.lineWidth = 2.5;
  context.lineJoin = "round";
  context.stroke();

  events.filter(event => event.day >= start && event.day <= day).forEach((event, index) => {
    const cx = x(event.day);
    const cy = y(values[event.day - start]);
    context.beginPath();
    context.arc(cx, cy, 11, 0, 2 * Math.PI);
    context.fillStyle = "#2457dc";
    context.fill();
    context.strokeStyle = "white";
    context.stroke();
    context.fillStyle = "white";
    context.textAlign = "center";
    context.fillText(index + 1, cx, cy + 4);
  });
  chartDetail.hidden = inspectedDay === null || inspectedDay < start || inspectedDay > day;
  if (!chartDetail.hidden) {
    const point = prices[inspectedDay];
    const cx = x(inspectedDay);
    const cy = y(point.cents / 100);
    context.beginPath();
    context.moveTo(cx, plot.top);
    context.lineTo(cx, plot.bottom);
    context.strokeStyle = "#64748b";
    context.lineWidth = 1;
    context.setLineDash([3, 3]);
    context.stroke();
    context.setLineDash([]);
    context.beginPath();
    context.arc(cx, cy, 4, 0, 2 * Math.PI);
    context.fillStyle = "#2457dc";
    context.fill();
    byId("hover-date").textContent = fullDate(point.date);
    byId("hover-price").textContent = money(point.cents);
    chartDetail.style.left = Math.max(0, Math.min(cx + 10, width - chartDetail.offsetWidth)) + "px";
  }
}

canvas.addEventListener("pointermove", event => {
  if (animationFrame !== null || !chartRange) return;
  const {start, day, span, left, right} = chartRange;
  const offset = event.clientX - canvas.getBoundingClientRect().left;
  inspectedDay = Math.max(start, Math.min(day, start + Math.round((offset - left) / (right - left) * span)));
  drawChart();
});
function hideInspection() {
  inspectedDay = null;
  drawChart();
}
canvas.addEventListener("pointerleave", hideInspection);
canvas.addEventListener("blur", hideInspection);
canvas.addEventListener("keydown", event => {
  if (animationFrame !== null || !chartRange || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const {start, day} = chartRange;
  const current = inspectedDay ?? day;
  inspectedDay = event.key === "Home" ? start : event.key === "End" ? day :
    Math.max(start, Math.min(day, current + (event.key === "ArrowLeft" ? -1 : 1)));
  drawChart();
});

function tradeSummary(order) {
  const name = order.action[0].toUpperCase() + order.action.slice(1);
  return order.rejected
    ? name + " order for " + order.shares + " shares did not fill on " + shortDate(order.date) + " due to insufficient available cash at the close."
    : name + " · " + order.shares + " shares at " + money(order.cents) + " on " + shortDate(order.date);
}

function render() {
  playhead = currentDay(game);
  inspectedDay = null;
  const day = currentDay(game);
  const quote = prices[day];
  const event = events[game.event];
  const account = portfolio(game);
  byId("price").textContent = money(quote.cents);
  const year = quote.date.slice(0, 4);
  const yearWindow = years.get(year);
  const nextYear = events[game.event + 1];
  const checkpoint = event.checkpoint;
  byId("period").textContent = shortDate(prices[yearWindow.start].date) + " – " + shortDate(prices[yearWindow.end].date) + ", " + year;
  byId("date").textContent = shortDate(quote.date) + ", " + year + " close";
  byId("chart-title").textContent = "Daily close · " + year + " (USD)";
  byId("decision-title").textContent = game.stopped ? "Cashed out" :
    checkpoint ? (event.partial ? "Replay results through " + fullDate(quote.date) : year + " year-end") : "Trade";
  const baseline = startingCash * quote.cents / prices[events[0].day + 1].cents;
  const gain = account.equity - game.yearStartEquity;
  const annualReturn = game.yearStartEquity > 0
    ? " (" + (gain / game.yearStartEquity * 100).toFixed(1) + "%)" : "";
  const total = account.equity - startingCash;
  const totalPercent = (total / startingCash * 100).toFixed(1);
  byId("decision-copy").textContent = checkpoint
    ? "Since you started with $10,000: " + money(total) + " (" + totalPercent + "%). " +
      "Balance: " + money(account.equity) + ". This year: " + money(gain) + annualReturn +
      ". Buy-and-hold balance: " + money(baseline) + "."
    : "";
  byId("decision-copy").hidden = !checkpoint;
  form.hidden = checkpoint;
  updateTradeFields();
  byId("checkpoint-actions").hidden = !checkpoint || game.stopped;
  byId("continue").hidden = !nextYear;
  byId("continue").textContent = nextYear ? "Continue to " + prices[nextYear.day].date.slice(0, 4) : "";
  byId("stop").textContent = "Cash out";
  tradeButton.textContent = events[game.event + 1]?.checkpoint ? "Advance to year-end" : "Advance to next event";
  byId("equity").textContent = money(account.equity);
  byId("available").textContent = money(account.available);
  byId("position").textContent = game.position === 0 ? "No shares" :
    Math.abs(game.position) + (game.position < 0 ? " short" : " long");
  byId("timeline").replaceChildren(...events.slice(0, game.event + 1).filter(item => item.day >= yearWindow.start).map((item, index) => {
    const row = document.createElement("li");
    row.classList.toggle("current", item === event);
    const date = document.createElement("span");
    const number = document.createElement("span");
    number.className = "event-number";
    number.textContent = index + 1;
    date.append(number, shortDate(prices[item.day].date));
    const title = document.createElement("strong");
    title.textContent = item.checkpoint ? (item.partial ? "Latest simulated session" : item.year + " year-end") : item.title;
    const copy = document.createElement("p");
    copy.textContent = item.copy ?? "Annual portfolio checkpoint.";
    row.append(date, title, copy);
    if (!item.checkpoint && item.day < day) {
      const change = (prices[item.day + 1].cents / prices[item.day].cents - 1) * 100;
      const sign = change >= 0 ? "+" : "−";
      const reaction = document.createElement("p");
      reaction.textContent = "Next close: " + sign + Math.abs(change).toFixed(1) + "%";
      row.append(reaction);
    }
    return row;
  }));
  const timeline = byId("timeline");
  timeline.scrollLeft = timeline.scrollWidth - timeline.clientWidth;
  byId("history-section").hidden = !game.history.length;
  byId("history").replaceChildren(...game.history.map(order => {
    const item = document.createElement("li");
    item.textContent = tradeSummary(order);
    return item;
  }));
  drawChart();
}

function updateTradeFields() {
  const holding = action.value === "hold";
  shares.disabled = holding;
  const note = byId("trade-note");
  note.hidden = form.hidden || holding;
  note.textContent = action.value === "short"
    ? "Fills at the next close. Short positions reserve collateral."
    : "Fills at the next close.";
}

action.addEventListener("change", updateTradeFields);
const tradeButton = form.querySelector("button");

function finishAdvance(next) {
  const order = next.history.length > game.history.length ? next.history.at(-1) : null;
  game = next;
  animationFrame = null;
  action.value = "hold";
  action.disabled = false;
  shares.disabled = true;
  tradeButton.disabled = false;
  byId("continue").disabled = false;
  byId("stop").disabled = false;
  render();
  byId("message").textContent = order ? tradeSummary(order) :
    (events[game.event].checkpoint ? "Reached the year-end close." : "Ready for the next decision.");
}

function animateAdvance(next) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishAdvance(next);
    return;
  }
  inspectedDay = null;
  const from = currentDay(game);
  const to = currentDay(next);
  const duration = 1450;
  let started;
  action.disabled = true;
  shares.disabled = true;
  tradeButton.disabled = true;
  byId("continue").disabled = true;
  byId("stop").disabled = true;
  tradeButton.textContent = "Replaying…";
  byId("message").textContent = "Advancing to the next decision.";
  function frame(timestamp) {
    started ??= timestamp;
    const progress = Math.min(1, (timestamp - started) / duration);
    const eased = progress * progress * (3 - 2 * progress);
    playhead = from + (to - from) * eased;
    const quote = prices[Math.floor(playhead)];
    byId("chart-title").textContent = "Daily close · " + quote.date.slice(0, 4) + " (USD)";
    byId("price").textContent = money(quote.cents);
    byId("date").textContent = shortDate(quote.date) + ", " + quote.date.slice(0, 4) + " close";
    drawChart();
    if (progress < 1) {
      animationFrame = requestAnimationFrame(frame);
    } else {
      finishAdvance(next);
    }
  }
  animationFrame = requestAnimationFrame(frame);
}

form.addEventListener("submit", event => {
  event.preventDefault();
  if (animationFrame !== null) return;
  try {
    animateAdvance(advance(game, action.value, Number(shares.value)));
  } catch (error) {
    byId("message").textContent = error.message;
  }
});
byId("continue").addEventListener("click", () => {
  if (animationFrame === null) animateAdvance(advance(game, "continue", 0));
});
byId("stop").addEventListener("click", () => {
  if (animationFrame !== null) return;
  game = advance(game, "stop", 0);
  byId("message").textContent = "";
  render();
});
byId("reset").addEventListener("click", () => {
  if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  animationFrame = null;
  game = newGame();
  form.reset();
  byId("continue").disabled = false;
  byId("stop").disabled = false;
  action.disabled = false;
  tradeButton.disabled = false;
  shares.disabled = true;
  byId("message").textContent = "";
  render();
});
new ResizeObserver(drawChart).observe(canvas);
render();
