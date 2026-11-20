const anchors = [[0, 87], [8, 91], [18, 99], [24, 95], [32, 107], [40, 102], [50, 118],
  [57, 94], [64, 101], [72, 97], [84, 112], [89, 89], [96, 78], [104, 84], [113, 73], [124, 86],
  [145, 94], [166, 103], [189, 82], [210, 69], [235, 77], [259, 72],
  [280, 80], [301, 67], [328, 61], [351, 76], [376, 68],
  [400, 83], [425, 90], [450, 75], [478, 85], [500, 96], [520, 91]];

const marketDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});
export const today = marketDate.format(new Date());

function makePrices() {
  const prices = [];
  const date = new Date("2000-01-03T00:00:00Z");
  for (let day = 0; date.toISOString().slice(0, 10) <= today; day++) {
    if (day > anchors.at(-1)[0]) {
      const elapsed = day - anchors.at(-1)[0];
      const drift = .008 * elapsed;
      const variation = 15 * Math.sin(elapsed / 91) + 10 * Math.sin(elapsed / 36) +
        5 * Math.sin(elapsed / 9) + 2 * Math.sin(elapsed * 1.67);
      prices.push({date: date.toISOString().slice(0, 10), cents: Math.round((91 + drift + variation) * 100)});
      do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
      continue;
    }
    const upper = anchors.findIndex(([index]) => index >= day);
    const [end, endPrice] = anchors[upper];
    const [start, startPrice] = anchors[Math.max(0, upper - 1)];
    const blend = end === start ? 0 : (day - start) / (end - start);
    const variation = Math.sin(Math.PI * blend) * (Math.sin(day * 2.2) * 2.6);
    prices.push({date: date.toISOString().slice(0, 10),
      cents: Math.round((startPrice + (endPrice - startPrice) * blend + variation) * 100)});
    do { date.setUTCDate(date.getUTCDate() + 1); } while ([0, 6].includes(date.getUTCDay()));
  }
  return prices;
}

export const prices = makePrices();
const headlines = [
  {day: 0, title: "Technology shares are in favor", copy: "Investors are paying up for tech growth. You have $10,000 in virtual cash to start the year."},
  {day: 40, title: "Rates are back in focus", copy: "Market commentary turns toward tighter monetary policy. Analysts disagree about what higher rates would mean for growth stocks."},
  {day: 57, title: "Volatility spikes", copy: "A broad tech selloff hits the market. Apple falls with its peers, and traders are split on whether the decline has run its course."},
  {day: 84, title: "Demand outlook improves", copy: "An upbeat product-demand update helps Apple rebound. Investors debate whether the recent gains already reflect that news."},
  {day: 104, title: "Confidence in the rebound fades", copy: "Technology shares remain volatile. Slower spending and weaker sentiment put pressure on the sector again."},
  {day: 166, title: "The rally returns", copy: "Technology shares recover as buyers return to the sector. Traders are watching for signs that demand can sustain the rally."},
  {day: 210, title: "Growth forecasts cool", copy: "Analysts cut their estimates for the sector as customers delay purchases."},
  {day: 280, title: "A cautious start to the year", copy: "Tech shares recover from year-end lows, while investors wait for companies to report holiday demand."},
  {day: 328, title: "Sentiment weakens again", copy: "Mixed earnings and slower spending put pressure on the market."},
  {day: 400, title: "Buyers return to tech", copy: "Technology shares rebound as investors anticipate a recovery in demand."},
  {day: 450, title: "The rebound hits a setback", copy: "Mixed product forecasts prompt another selloff."},
  {day: 500, title: "Holiday outlook brightens", copy: "Analysts raise sales estimates heading into the final weeks of the year."},
];
const marketEvents = [
  {title: "Earnings outlook shifts", copy: "Investors reassess how much future growth is already reflected in the share price."},
  {title: "A new product cycle begins", copy: "Analysts differ on whether stronger demand will outweigh higher costs."},
  {title: "Investors reassess interest rates", copy: "The outlook for borrowing costs has shifted. Traders are weighing what it means for technology valuations."},
  {title: "Tech sentiment turns cautious", copy: "A mixed set of earnings reports raises questions about demand across the sector."},
  {title: "Demand forecasts diverge", copy: "Some analysts expect a rebound, while others flag softer spending."},
];

export const years = new Map();
const generated = [];
const yearEnds = [];
let start = 0;
prices.forEach((point, day) => {
  const year = point.date.slice(0, 4);
  if (prices[day + 1]?.date.startsWith(year)) return;
  years.set(year, {start, end: day});
  yearEnds.push({day, year, checkpoint: true,
    partial: year === today.slice(0, 4) && today.slice(5) !== "12-31"});
  if (year > "2001") {
    [0, 65, 130, 195].forEach((offset, index) => {
      if (start + offset >= day) return;
      generated.push({day: start + offset, ...marketEvents[(Number(year) + index) % marketEvents.length]});
    });
  }
  start = day + 1;
});
export const events = [...headlines, ...generated, ...yearEnds].sort((a, b) => a.day - b.day);

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
