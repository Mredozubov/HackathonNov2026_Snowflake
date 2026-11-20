// Replay positions use the share basis of the source close series.
export let prices = [];
export let events = [];
export let years = new Map();
let firstEvent = 0;

export function configureReplay(company, startDate) {
  prices = company.prices.map(([date, close]) => ({date, cents: close * 100}));
  firstEvent = prices.findIndex(point => point.date >= startDate);
  if (firstEvent < 0 || firstEvent >= prices.length - 1) {
    throw new Error("Choose a start date with at least one later close.");
  }
  const firstDay = firstEvent;
  const sessions = new Map(prices.map((point, index) => [point.date, index]));
  years = new Map();
  const stops = new Map();
  let start = firstDay;
  for (let day = firstDay; day < prices.length; day++) {
    const year = prices[day].date.slice(0, 4);
    if (prices[day + 1]?.date.startsWith(year)) continue;
    years.set(year, {start, end: day});
    if (start < day) stops.set(start, {day: start, title: "Trading opens", copy: "Review the prices available at this point."});
    stops.set(day, {day, year, checkpoint: true,
      partial: day === prices.length - 1 && Number(prices[day].date.slice(5).replace("-", "")) < 1228});
    start = day + 1;
  }
  for (const disclosure of company.events) {
    const publicDate = disclosure.date;
    if (publicDate < prices[firstDay].date || publicDate > prices.at(-1).date) continue;
    // The game decides after the filing day has ended. Orders fill at the following close.
    let day = sessions.get(publicDate);
    if (day === undefined) day = prices.findIndex(point => point.date > publicDate);
    if (day < firstDay || stops.get(day)?.checkpoint) continue;
    const previous = stops.get(day);
    if (previous?.sources) {
      previous.sources.push(disclosure);
    } else {
      stops.set(day, {day, title: disclosure.title, copy: disclosure.copy, sources: [disclosure]});
    }
  }
  events = [...stops.values()].sort((a, b) => a.day - b.day);
}

export const startingCash = 1_000_000;

export function newGame() {
  return {event: 0, cash: startingCash, position: 0, history: [], yearStartEquity: startingCash, stopped: false};
}

export function currentDay(game) {
  return events[game.event]?.day ?? prices.length - 1;
}

export function portfolio(game) {
  const close = prices[currentDay(game)].cents;
  return {equity: game.cash + game.position * close,
    available: Math.max(0, game.cash - 2 * Math.max(0, -game.position) * close)};
}

export function advance(game, action, shares) {
  if (game.stopped || game.event >= events.length) return game;
  if (events[game.event].checkpoint) {
    if (action === "stop") {
      return {...game, cash: portfolio(game).equity, position: 0, stopped: true};
    }
    if (action === "continue" && game.event < events.length - 1) {
      return {...game, event: game.event + 1, yearStartEquity: portfolio(game).equity};
    }
    return game;
  }
  const next = {...game, event: game.event + 1};
  if (action === "hold") return next;
  if (!["buy", "sell", "short", "cover"].includes(action) ||
      !Number.isSafeInteger(shares) || shares < 1 || shares > 100000) {
    throw new Error("Enter a whole number of shares from 1 to 100,000.");
  }
  if (action === "sell" && shares > game.position) throw new Error("You can only sell shares you own.");
  if (action === "cover" && shares > -game.position) throw new Error("You can only cover shares you shorted.");
  if (action === "buy" && game.position < 0) throw new Error("Cover the short position before buying.");
  if (action === "short" && game.position > 0) throw new Error("Sell the long position before shorting.");

  const fill = prices[currentDay(game) + 1];
  const total = fill.cents * shares;
  const buying = action === "buy" || action === "cover";
  const availableAtFill = game.cash - 2 * Math.max(0, -game.position) * fill.cents;
  if ((action === "buy" || action === "short") && total > availableAtFill) {
    return {...next, history: [...game.history, {action, shares, date: fill.date, rejected: true}]};
  }

  return {...next, cash: game.cash + (buying ? -total : total),
    position: game.position + (buying ? shares : -shares),
    history: [...game.history, {action, shares, date: fill.date, cents: fill.cents}]};
}
