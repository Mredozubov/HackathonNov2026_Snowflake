const status = document.querySelector("#status");
const selector = document.querySelector("#company");
const formNames = { "10-K": "Annual report", "10-Q": "Quarterly report", "8-K": "Current report" };

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text, url, className) {
  const node = element("a", text, className);
  node.href = url;
  return node;
}

function render(company) {
  const max = Math.max(1, ...company.revenue.map(point => point.value));
  const bars = company.revenue.map(point => {
    const amount = "$" + (point.value / 1e9).toFixed(1) + "B";
    const row = link(null, point.url, "bar-row");
    row.classList.toggle("derived", point.basis === "Derived Q4");
    row.setAttribute("aria-label", point.date + " · " + amount + " · " + point.basis + " · SEC filing");
    row.title = point.basis;
    const track = element("span", null, "track");
    const bar = element("span", null, "bar");
    bar.style.width = (point.value / max * 100) + "%";
    track.append(bar);
    row.append(element("time", point.date), track, element("span", amount));
    return row;
  });
  const filings = company.filings.map(filing => {
    const row = element("li");
    row.append(element("time", filing.date),
      link(filing.form + " · " + formNames[filing.form], filing.url));
    return row;
  });
  document.querySelector("#revenue").replaceChildren(...(bars.length ? bars : ["No revenue records available."]));
  document.querySelector("#filings").replaceChildren(...(filings.length ? filings : [element("li", "No filings available.")]));
}

async function start() {
  try {
    const response = await fetch("dashboard.json");
    if (!response.ok) throw new Error("Dashboard data is unavailable.");
    const snapshot = await response.json();
    if (!snapshot.companies.length) throw new Error("No companies in this snapshot.");
    snapshot.companies.forEach((company, index) => {
      const option = element("option", company.name + " (" + company.ticker + ")");
      option.value = index;
      selector.append(option);
    });
    selector.addEventListener("change", () => render(snapshot.companies[selector.value]));
    render(snapshot.companies[0]);
    selector.hidden = false;
    document.querySelector('label[for="company"]').hidden = false;
    document.querySelector("#dashboard").hidden = false;
    const source = snapshot.preview ? "EDGAR preview" : "Snowflake export";
    status.textContent = source + " · Updated " + new Date(snapshot.refreshedAt).toLocaleString();
  } catch (error) {
    status.textContent = "Dashboard data unavailable. Run the Snowflake loader to generate a snapshot.";
  }
}

start();
