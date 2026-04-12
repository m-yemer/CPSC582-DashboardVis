// ── layout & color constants ──
const CHART_MARGINS = { top: 34, right: 24, bottom: 52, left: 62 };
const COLORS = {
  cpu: "#2f80ed",
  gpu: "#eb5757",
  ram: "#27ae60"
};
// two-slot compare highlight colors for points labeled A and B
const COMPARE_COLORS = ["#0891b2", "#ea580c"];

// global application state — all chart updates read from here
const state = {
  raw: [],
  filtered: [],
  selectedGame: null,
  minYear: 2015,
  maxYear: 2024,
  gpuBrand: "All",
  ram: "All",
  searchTerm: "",
  showFrontier: true,
  activeComponents: new Set(["cpu", "gpu", "ram"]),
  barMode: "grouped",
  compareGames: [],
  gpuDomain: []
};

// cached d3 selections — avoids repeated dom queries on every redraw
const tooltip = d3.select("#tooltip");
const scatterSvg = d3.select("#scatterChart");
const barSvg = d3.select("#barChart");
const histSvg = d3.select("#histChart");
const summarySvg = d3.select("#summaryChart");
const gpuDominanceSvg = d3.select("#gpuDominanceChart");

let floatingCard = null;

init();

// ── startup ──
async function init() {
  setupThemeToggle();

  const preferredFiles = ["../games_all_optimized_cpu_matching.csv", "../steam_hardware.csv", "games_all_optimized_cpu_matching.csv", "steam_hardware.csv"];
  let loadedRows;

  try {
    loadedRows = await loadCompatibleData(preferredFiles);
  } catch {
    showDataError("Could not load data file. Expected games_all_optimized_cpu_matching.csv.");
    return;
  }

  // discard rows missing any required pricing or identification fields
  state.raw = loadedRows.filter(d =>
    d.game_name &&
    Number.isFinite(d.release_year) &&
    Number.isFinite(d.cpu_price) &&
    Number.isFinite(d.gpu_price) &&
    Number.isFinite(d.ram_price) &&
    Number.isFinite(d.total_price) &&
    d.gpu_brand &&
    Number.isFinite(d.ram_gb)
  );

  if (!state.raw.length) {
    showDataError("No valid rows found after parsing. Check required pricing/year fields in the CSV.");
    return;
  }

  d3.select(".subtitle").text("This project explores estimated recommended build costs over time, comparing component mix and how demanding published game specs became.");

  // collect unique gpu brands for the color scale and brand filter dropdown
  state.gpuDomain = Array.from(new Set(state.raw.map(d => d.gpu_brand))).sort(d3.ascending);
  setupControls();
  setupCardExpandControls();
  setupIntroCard();
  createScatterPlot();
  createBarChart();
  createHistogram();
  createSummaryChart();
  createGpuDominanceChart();
  updateCharts();

  window.addEventListener("resize", debounce(() => {
    createScatterPlot();
    createBarChart();
    createHistogram();
    createSummaryChart();
    createGpuDominanceChart();
    updateCharts();
  }, 140));
}

// ── control event wiring ──
function setupControls() {
  const layoutShell = d3.select("#layoutShell");
  const sidebarToggle = d3.select("#sidebarToggle");
  const yearMin = d3.select("#yearMin");
  const yearMax = d3.select("#yearMax");
  const yearRangeFill = d3.select("#yearRangeFill");
  const yearRangeLabel = d3.select("#yearRangeLabel");
  const gpuFilter = d3.select("#gpuFilter");
  const ramFilter = d3.select("#ramFilter");
  const gameSearch = d3.select("#gameSearch");
  const gameSuggestions = d3.select("#gameSuggestions");
  const showFrontier = d3.select("#showFrontier");
  const addToCompare = d3.select("#addToCompare");
  const clearCompare = d3.select("#clearCompare");
  const clearSelection = d3.select("#clearSelection");

  // updates the sliding track fill and text label to match the current min/max year
  const syncYearRangeUI = () => {
    const minBound = +yearMin.attr("min");
    const maxBound = +yearMin.attr("max");
    const span = Math.max(1, maxBound - minBound);
    const leftPct = ((state.minYear - minBound) / span) * 100;
    const rightPct = ((state.maxYear - minBound) / span) * 100;

    yearRangeFill
      .style("left", `${leftPct}%`)
      .style("width", `${Math.max(0, rightPct - leftPct)}%`);

    yearRangeLabel.text(`${state.minYear} - ${state.maxYear}`);
  };

  // reflects the activeComponents set onto chip active classes
  const syncComponentButtons = () => {
    d3.selectAll("#componentToggles .chip")
      .classed("active", function () {
        return state.activeComponents.has(this.dataset.component);
      });
  };

  const syncBarModeButtons = () => {
    d3.selectAll("#barModeToggles .chip")
      .classed("active", function () {
        return this.dataset.mode === state.barMode;
      });
  };

  const syncSidebarToggleUI = () => {
    const collapsed = layoutShell.classed("sidebar-collapsed");
    sidebarToggle
      .attr("aria-expanded", String(!collapsed))
      .attr("title", collapsed ? "Expand filter panel" : "Collapse filter panel")
      .text(collapsed ? "Open" : "Collapse");
  };

  gpuFilter.selectAll("option.gpu-option")
    .data(state.gpuDomain)
    .join("option")
    .attr("class", "gpu-option")
    .attr("value", d => d)
    .text(d => d);

  const ramValues = Array.from(new Set(state.raw.map(d => d.ram_gb))).sort((a, b) => a - b);
  ramFilter.selectAll("option.ram-option")
    .data(ramValues)
    .join("option")
    .attr("class", "ram-option")
    .attr("value", d => String(d))
    .text(d => `${d} GB`);

  const gameNames = Array.from(new Set(state.raw.map(d => d.game_name))).sort(d3.ascending);
  gameSuggestions.selectAll("option")
    .data(gameNames)
    .join("option")
    .attr("value", d => d);

  yearMin.on("input", function () {
    state.minYear = +this.value;
    if (state.minYear > state.maxYear) {
      state.maxYear = state.minYear;
      yearMax.property("value", state.maxYear);
    }
    syncYearRangeUI();
    updateCharts();
  });

  yearMax.on("input", function () {
    state.maxYear = +this.value;
    if (state.maxYear < state.minYear) {
      state.minYear = state.maxYear;
      yearMin.property("value", state.minYear);
    }
    syncYearRangeUI();
    updateCharts();
  });

  gpuFilter.on("change", function () {
    state.gpuBrand = this.value;
    updateCharts();
  });

  ramFilter.on("change", function () {
    state.ram = this.value;
    updateCharts();
  });

  gameSearch.on("input", function () {
    state.searchTerm = this.value.trim().toLowerCase();
    updateCharts();
  });

  showFrontier.on("change", function () {
    state.showFrontier = this.checked;
    updateCharts();
  });

  d3.select("#componentToggles")
    .selectAll("button")
    .on("click", function () {
      const component = this.dataset.component;
      if (state.activeComponents.has(component)) {
        state.activeComponents.delete(component);
      } else {
        state.activeComponents.add(component);
      }

      if (state.activeComponents.size === 0) {
        state.activeComponents.add(component);
      }

      syncComponentButtons();
      updateCharts();
    });

  d3.select("#barModeToggles")
    .selectAll("button")
    .on("click", function () {
      state.barMode = this.dataset.mode;
      syncBarModeButtons();
      updateCharts();
    });

  clearSelection.on("click", () => {
    state.minYear = 2015;
    state.maxYear = 2024;
    state.gpuBrand = "All";
    state.ram = "All";
    state.searchTerm = "";
    state.showFrontier = true;
    state.activeComponents = new Set(["cpu", "gpu", "ram"]);
    state.barMode = "grouped";
    state.selectedGame = null;
    state.compareGames = [];

    yearMin.property("value", state.minYear);
    yearMax.property("value", state.maxYear);
    gpuFilter.property("value", state.gpuBrand);
    ramFilter.property("value", state.ram);
    gameSearch.property("value", "");
    showFrontier.property("checked", state.showFrontier);

    syncYearRangeUI();
    syncComponentButtons();
    syncBarModeButtons();
    updateCharts();
  });

  // adds the currently selected game to the compare queue, capped at 2 slots
  addToCompare.on("click", () => {
    if (!state.selectedGame) {
      return;
    }

    if (state.compareGames.length >= 2) {
      return;
    }

    if (state.compareGames.some(g => isSameGame(g, state.selectedGame))) {
      return;
    }

    state.compareGames.push(state.selectedGame);
    updateCharts();
  });

  clearCompare.on("click", () => {
    state.compareGames = [];
    updateCharts();
  });

  sidebarToggle.on("click", () => {
    const isCollapsed = layoutShell.classed("sidebar-collapsed");
    layoutShell.classed("sidebar-collapsed", !isCollapsed);
    syncSidebarToggleUI();
    // Trigger chart resize logic after layout transition starts.
    window.dispatchEvent(new Event("resize"));
  });

  syncYearRangeUI();
  syncCompareUI();
  syncSidebarToggleUI();
}

// ── chart update pipeline ──
function updateCharts() {
  // re-run all active control filters against the raw dataset
  state.filtered = state.raw.filter(d => {
    const inYear = d.release_year >= state.minYear && d.release_year <= state.maxYear;
    const inBrand = state.gpuBrand === "All" || d.gpu_brand === state.gpuBrand;
    const inRam = state.ram === "All" || d.ram_gb === +state.ram;
    const inSearch = !state.searchTerm || d.game_name.toLowerCase().includes(state.searchTerm);
    return inYear && inBrand && inRam && inSearch;
  });

  if (state.selectedGame) {
    const exists = state.filtered.find(d => d.game_name === state.selectedGame.game_name && d.release_year === state.selectedGame.release_year);
    if (!exists) {
      state.selectedGame = null;
    }
  }

  // drop any compare games that fell outside the current filter window
  state.compareGames = state.compareGames.filter(game =>
    state.filtered.some(row => isSameGame(row, game))
  );

  syncCompareUI();

  updateMetrics();

  updateScatter();
  updateBarChart();
  updateHistogram();
  updateSummary();
  updateGpuDominance();
}

// computes and renders the four summary metric cards above the charts
function updateMetrics() {
  const countNode = d3.select("#metricCount");
  const medianNode = d3.select("#metricMedianTotal");
  const shareNode = d3.select("#metricGpuShare");
  const trendNode = d3.select("#metricYoY");

  if (!state.filtered.length) {
    countNode.text("0");
    medianNode.text("-");
    shareNode.text("-");
    trendNode.text("-");
    return;
  }

  const count = state.filtered.length;
  const medianTotal = d3.median(state.filtered, d => d.total_price) || 0;
  const medianGpuShare = d3.median(state.filtered, d => (d.gpu_price / Math.max(1, d.total_price)) * 100) || 0;

  const byYearAvg = d3.rollups(
    state.filtered,
    v => d3.mean(v, d => d.total_price) || 0,
    d => d.release_year
  ).sort((a, b) => a[0] - b[0]);

  let trendText = "N/A";
  if (byYearAvg.length >= 2) {
    const first = byYearAvg[0][1];
    const last = byYearAvg[byYearAvg.length - 1][1];
    const years = Math.max(1, byYearAvg[byYearAvg.length - 1][0] - byYearAvg[0][0]);
    // annualized rate of change total % difference divided by the year span
    const annualPct = ((last - first) / Math.max(1, first)) * (100 / years);
    trendText = `${annualPct >= 0 ? "+" : ""}${d3.format(".1f")(annualPct)}%/yr`;
  }

  countNode.text(d3.format(",")(count));
  medianNode.text(`$${fmt(medianTotal)}`);
  shareNode.text(`${d3.format(".1f")(medianGpuShare)}%`);
  trendNode.text(trendText);
}

// ── scatter plot ──
function createScatterPlot() {
  setupSvg(scatterSvg);
  const { width, height, g } = getChartArea(scatterSvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("g").attr("class", "frontier-layer");
  g.append("g").attr("class", "marks");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Release Year");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("Total Price (USD)");
}

// re-renders scatter points with median reference line, selection, and compare highlights
function updateScatter() {
  const { width, height, g } = getChartArea(scatterSvg);
  const x = d3.scaleLinear().domain([state.minYear - 0.5, state.maxYear + 0.5]).range([0, width]);
  const yMax = d3.max(state.filtered, d => d.total_price) || 100;
  const y = d3.scaleLinear().domain([0, yMax * 1.08]).nice().range([height, 0]);
  const gpuColor = getGpuColorScale();
  renderScatterLegend(gpuColor);

  g.select(".x-axis").transition().duration(600)
    .call(d3.axisBottom(x).ticks(Math.min(state.maxYear - state.minYear + 1, 10)).tickFormat(d3.format("d")));

  g.select(".y-axis").transition().duration(600)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d => `$${d3.format(",.0f")(d)}`));

  // per-year median price used for the dashed yearly reference line
  const frontier = d3.rollups(
    state.filtered,
    v => d3.median(v, d => d.total_price),
    d => d.release_year
  ).sort((a, b) => a[0] - b[0]);

  const frontierMap = new Map(frontier);
  const isNearFrontier = d => {
    const median = frontierMap.get(d.release_year);
    return Number.isFinite(median) && Math.abs(d.total_price - median) <= Math.max(20, median * 0.08);
  };

  const scatterMeta = d3.select("#scatterMeta");
  if (state.showFrontier && frontier.length > 1) {
    const frontierLayer = g.select(".frontier-layer");
    const line = d3.line()
      .x(d => x(d[0]))
      .y(d => y(d[1]))
      .curve(d3.curveMonotoneX);

    frontierLayer.selectAll("path.frontier-path")
      .data([frontier])
      .join("path")
      .attr("class", "frontier-path")
      .attr("fill", "none")
      .attr("stroke", "#f59e0b")
      .attr("stroke-width", 2.4)
      .attr("stroke-dasharray", "6 4")
      .transition()
      .duration(620)
      .attr("d", line);

    frontierLayer.selectAll("circle.frontier-point")
      .data(frontier, d => d[0])
      .join(
        enter => enter.append("circle").attr("class", "frontier-point").attr("r", 0).attr("fill", "#f59e0b"),
        update => update,
        exit => exit.transition().duration(250).attr("r", 0).remove()
      )
      .transition()
      .duration(620)
      .attr("cx", d => x(d[0]))
      .attr("cy", d => y(d[1]))
      .attr("r", 4.2);

    scatterMeta.text("Scatter plot with yearly median line (dashed): median total price per year. Click any point, then use Compare controls.");
  } else {
    g.select(".frontier-layer").selectAll("*").remove();
    scatterMeta.text("Scatter plot: point color by GPU brand; click a point to focus a game or add it to compare.");
  }

  // stable per-point x-jitter so positions don't shift when only styles change
  const jitter = 0.3;
  const jitteredYear = d => d.release_year + getStableJitter(d, jitter);
  const points = g.select(".marks")
    .selectAll("circle")
    .data(state.filtered, d => `${d.game_name}-${d.release_year}`);

  points.exit().transition().duration(320).attr("r", 0).remove();

  points.transition().duration(600)
    .attr("cx", d => x(jitteredYear(d)))
    .attr("cy", d => y(d.total_price))
    .attr("fill", d => gpuColor(d.gpu_brand) || "#8e8e93")
    .attr("stroke", d => {
      if (state.selectedGame && isSameGame(d, state.selectedGame)) {
        return "#111827";
      }
      const compareIndex = getCompareIndex(d);
      if (compareIndex !== -1) {
        return COMPARE_COLORS[compareIndex];
      }
      if (state.showFrontier && isNearFrontier(d)) {
        return "#f59e0b";
      }
      return "#fff";
    })
    .attr("stroke-width", d => {
      if (state.selectedGame && isSameGame(d, state.selectedGame)) {
        return 2.8;
      }
      if (getCompareIndex(d) !== -1) {
        return 2.4;
      }
      if (state.showFrontier && isNearFrontier(d)) {
        return 2;
      }
      return 1.2;
    })
    .attr("opacity", d => state.selectedGame && !isSameGame(d, state.selectedGame) && getCompareIndex(d) === -1 ? 0.28 : 0.85)
    .attr("r", d => {
      if (state.selectedGame && isSameGame(d, state.selectedGame)) {
        return 8.5;
      }
      if (getCompareIndex(d) !== -1) {
        return 7;
      }
      return 5.6;
    });

  points.enter()
    .append("circle")
    .attr("cx", d => x(jitteredYear(d)))
    .attr("cy", d => y(d.total_price))
    .attr("r", 0)
    .attr("fill", d => gpuColor(d.gpu_brand) || "#8e8e93")
    .attr("stroke", d => {
      const compareIndex = getCompareIndex(d);
      if (compareIndex !== -1) {
        return COMPARE_COLORS[compareIndex];
      }
      return state.showFrontier && isNearFrontier(d) ? "#f59e0b" : "#fff";
    })
    .attr("stroke-width", d => {
      if (getCompareIndex(d) !== -1) {
        return 2.4;
      }
      return state.showFrontier && isNearFrontier(d) ? 2 : 1.1;
    })
    .attr("opacity", 0.85)
    .on("mousemove", (event, d) => {
      showTooltip(event, `
        <strong>${escapeHtml(d.game_name)}</strong><br>
        Year: ${d.release_year}<br>
        CPU: $${fmt(d.cpu_price)}<br>
        GPU: $${fmt(d.gpu_price)}<br>
        RAM: $${fmt(d.ram_price)}<br>
        <strong>Total: $${fmt(d.total_price)}</strong><br>
        GPU Brand: ${escapeHtml(d.gpu_brand)}<br>
        RAM: ${d.ram_gb} GB
      `);
    })
    .on("mouseleave", hideTooltip)
    .on("click", (_, d) => {
      state.selectedGame = (state.selectedGame && isSameGame(d, state.selectedGame)) ? null : d;
      updateCharts();
    })
    .transition()
    .duration(560)
    .attr("r", d => {
      if (state.selectedGame && isSameGame(d, state.selectedGame)) {
        return 8.5;
      }
      if (getCompareIndex(d) !== -1) {
        return 7;
      }
      return 5.6;
    });
}

// ordinal color scale keyed to the sorted list of discovered gpu brands
function getGpuColorScale() {
  return d3.scaleOrdinal()
    .domain(state.gpuDomain)
    .range(d3.schemeTableau10);
}

// rebuilds legend entries: gpu brands plus the median reference line
function renderScatterLegend(gpuColor) {
  const legend = d3.select("#scatterLegend");
  const legendItems = [
    ...state.gpuDomain.map(brand => ({
      label: brand,
      color: gpuColor(brand),
      isLine: false
    })),
    {
      label: "Yearly median line",
      color: "#f59e0b",
      isLine: true
    }
  ];

  const items = legend.selectAll("div.legend-item")
    .data(legendItems, d => d.label);

  items.exit().remove();

  const enter = items.enter()
    .append("div")
    .attr("class", "legend-item");

  enter.append("span").attr("class", "legend-swatch");
  enter.append("span").attr("class", "legend-label");

  const merged = enter.merge(items);
  merged.select(".legend-label").text(d => d.label);
  merged.select(".legend-swatch")
    .classed("legend-line", d => d.isLine)
    .style("background", d => d.isLine ? "transparent" : d.color)
    .style("border-color", d => d.isLine ? null : "rgba(0, 0, 0, 0.08)");
}

// ── bar chart ──
function createBarChart() {
  setupSvg(barSvg);
  const { width, height, g } = getChartArea(barSvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("g").attr("class", "bars");
  g.append("g").attr("class", "stack-layer");

  g.append("text")
    .attr("class", "axis-label bar-x-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Release Year / Selected / Compare");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -46)
    .attr("text-anchor", "middle")
    .text("Price (USD)");
}

// switches between compare mode, single-game breakdown, or yearly averages
function updateBarChart() {
  const { width, height, g } = getChartArea(barSvg);
  const selectedComponents = ["cpu", "gpu", "ram"].filter(c => state.activeComponents.has(c));
  const activeSet = new Set(selectedComponents);

  let data;
  let xValues;
  let xAxisLabel = "Release Year";
  let title = "Average Estimated CPU, GPU, and RAM Cost by Release Year";
  let meta = "Grouped bars show average CPU/GPU/RAM price per year.";

  // compare takes priority; falls back to selected game, then yearly aggregate
  if (state.compareGames.length) {
    data = state.compareGames.map((s, i) => ({
      key: `${i === 0 ? "A" : "B"}: ${s.game_name} (${s.release_year})`,
      cpu: s.cpu_price,
      gpu: s.gpu_price,
      ram: s.ram_price,
      total: s.total_price
    }));
    xValues = data.map(d => d.key);
    xAxisLabel = "Compared Games";
    title = "Compared Games: Estimated CPU, GPU, and RAM Cost";
    const compareSummary = state.compareGames
      .map((d, i) => `${i === 0 ? "A" : "B"}=${d.game_name} (${d.release_year})`)
      .join(" | ");
    meta = state.compareGames.length === 2
      ? `Comparing two selected games side-by-side. ${compareSummary}`
      : `One game in compare queue. Add another for side-by-side view. ${compareSummary}`;
  } else if (state.selectedGame) {
    const s = state.selectedGame;
    data = [{ key: `${s.game_name} (${s.release_year})`, cpu: s.cpu_price, gpu: s.gpu_price, ram: s.ram_price, total: s.total_price }];
    xValues = data.map(d => d.key);
    xAxisLabel = "Selected Game";
    title = `Selected Game: Estimated CPU, GPU, and RAM Cost (${s.game_name})`;
    meta = `Showing CPU, GPU, RAM cost for ${s.game_name} (${s.release_year}).`;
  } else {
    const roll = d3.rollups(
      state.filtered,
      values => ({
        cpu: d3.mean(values, d => d.cpu_price) || 0,
        gpu: d3.mean(values, d => d.gpu_price) || 0,
        ram: d3.mean(values, d => d.ram_price) || 0,
        total: d3.mean(values, d => d.total_price) || 0
      }),
      d => d.release_year
    ).sort((a, b) => a[0] - b[0]);

    data = roll.map(([year, values]) => ({ key: String(year), ...values }));
    xValues = data.map(d => d.key);
  }

  g.select(".bar-x-label").text(xAxisLabel);
  d3.select("#barTitle").text(title);
  d3.select("#barMeta").text(meta);

  if (!data.length) {
    clearBarMarks(g);
    drawBarAxes(g, d3.scaleBand().domain([]).range([0, width]), d3.scaleLinear().domain([0, 1]).range([height, 0]));
    drawEmpty(g, width, height, "No data for current filters");
    return;
  }
  g.selectAll("text.empty-msg").remove();

  const x0 = d3.scaleBand().domain(xValues).range([0, width]).padding(0.24);
  const x1 = d3.scaleBand().domain(selectedComponents).range([0, x0.bandwidth()]).padding(0.14);

  const ymaxGrouped = d3.max(data, d => d3.max(selectedComponents, c => d[c] || 0)) || 1;
  const ymaxStacked = d3.max(data, d => d3.sum(selectedComponents, c => d[c] || 0)) || 1;
  const y = d3.scaleLinear()
    .domain([0, (state.barMode === "stacked" ? ymaxStacked : ymaxGrouped) * 1.15])
    .nice()
    .range([height, 0]);

  drawBarAxes(g, x0, y);
  const trans = d3.transition().duration(650).ease(d3.easeCubicInOut);

  if (state.barMode === "grouped") {
    g.select(".stack-layer").selectAll("*").remove();

    const groups = g.select(".bars")
      .selectAll("g.bar-group")
      .data(data, d => d.key)
      .join(
        enter => enter.append("g").attr("class", "bar-group").attr("transform", d => `translate(${x0(d.key)},0)`),
        update => update,
        exit => exit.transition(trans).style("opacity", 0).remove()
      );

    groups.transition(trans).attr("transform", d => `translate(${x0(d.key)},0)`);

    const bars = groups.selectAll("rect.component-bar")
      .data(d => selectedComponents.map(c => ({ groupKey: d.key, component: c, value: d[c] || 0 })), d => d.component);

    bars.exit().transition(trans).attr("y", y(0)).attr("height", 0).remove();

    bars.transition(trans)
      .attr("x", d => x1(d.component))
      .attr("y", d => y(d.value))
      .attr("width", x1.bandwidth())
      .attr("height", d => y(0) - y(d.value))
      .attr("fill", d => COLORS[d.component]);

    bars.enter()
      .append("rect")
      .attr("class", "component-bar")
      .attr("x", d => x1(d.component))
      .attr("width", x1.bandwidth())
      .attr("y", y(0))
      .attr("height", 0)
      .attr("fill", d => COLORS[d.component])
      .on("mousemove", (event, d) => {
        showTooltip(event, `<strong>${escapeHtml(d.groupKey)}</strong><br>Component: ${d.component.toUpperCase()}<br>Value: $${fmt(d.value)}`);
      })
      .on("mouseleave", hideTooltip)
      .transition(trans)
      .attr("y", d => y(d.value))
      .attr("height", d => y(0) - y(d.value));
  } else {
    g.select(".bars").selectAll("*").remove();

    const stackInput = data.map(d => {
      const obj = { key: d.key };
      ["cpu", "gpu", "ram"].forEach(c => {
        obj[c] = activeSet.has(c) ? d[c] : 0;
      });
      return obj;
    });

    const series = d3.stack().keys(["cpu", "gpu", "ram"])(stackInput).filter(s => activeSet.has(s.key));

    const layers = g.select(".stack-layer")
      .selectAll("g.layer")
      .data(series, d => d.key)
      .join(
        enter => enter.append("g").attr("class", "layer").attr("fill", d => COLORS[d.key]),
        update => update.attr("fill", d => COLORS[d.key]),
        exit => exit.remove()
      );

    const rects = layers.selectAll("rect")
      .data(d => d.map(v => ({ key: d.key, x: v.data.key, y0: v[0], y1: v[1], value: v.data[d.key] })), d => `${d.key}-${d.x}`);

    rects.exit().transition(trans).attr("height", 0).attr("y", y(0)).remove();

    rects.transition(trans)
      .attr("x", d => x0(d.x))
      .attr("width", x0.bandwidth())
      .attr("y", d => y(d.y1))
      .attr("height", d => Math.max(0, y(d.y0) - y(d.y1)));

    rects.enter()
      .append("rect")
      .attr("x", d => x0(d.x))
      .attr("width", x0.bandwidth())
      .attr("y", y(0))
      .attr("height", 0)
      .on("mousemove", (event, d) => {
        showTooltip(event, `<strong>${escapeHtml(d.x)}</strong><br>Component: ${d.key.toUpperCase()}<br>Value: $${fmt(d.value)}`);
      })
      .on("mouseleave", hideTooltip)
      .transition(trans)
      .attr("y", d => y(d.y1))
      .attr("height", d => Math.max(0, y(d.y0) - y(d.y1)));
  }
}

// ── histogram ──
function createHistogram() {
  setupSvg(histSvg);
  const { width, height, g } = getChartArea(histSvg);
  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("g").attr("class", "bins");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Total Price Bins (USD)");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -42)
    .attr("text-anchor", "middle")
    .text("Game Count");
}

// bins total price values into 10 buckets and renders a teal bar histogram
function updateHistogram() {
  const { width, height, g } = getChartArea(histSvg);
  const values = state.filtered.map(d => d.total_price);

  if (!values.length) {
    g.select(".bins").selectAll("rect").remove();
    g.select(".x-axis").call(d3.axisBottom(d3.scaleLinear().domain([0, 1]).range([0, width])));
    g.select(".y-axis").call(d3.axisLeft(d3.scaleLinear().domain([0, 1]).range([height, 0])));
    drawEmpty(g, width, height, "No data for current filters");
    return;
  }

  g.selectAll("text.empty-msg").remove();

  const x = d3.scaleLinear().domain(d3.extent(values)).nice().range([0, width]);
  const bins = d3.bin().domain(x.domain()).thresholds(10)(values);
  const y = d3.scaleLinear().domain([0, d3.max(bins, d => d.length) || 1]).nice().range([height, 0]);
  const tickValues = [];
  bins.forEach((bin, i) => {
    if (i === 0) {
      tickValues.push(bin.x0);
    }
    tickValues.push(bin.x1);
  });

  g.select(".x-axis").transition().duration(600)
    .call(
      d3.axisBottom(x)
        .tickValues(tickValues)
        .tickFormat(d => `$${d3.format(",.0f")(d)}`)
    );

  // Keep numeric labels on every bin tick while improving legibility in tight widths.
  g.select(".x-axis").selectAll("text")
    .style("font-size", "11px")
    .attr("text-anchor", "end")
    .attr("transform", "rotate(-28)")
    .attr("dx", "-0.35em")
    .attr("dy", "0.35em");

  g.select(".y-axis").transition().duration(600)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d3.format("d")));

  const bars = g.select(".bins")
    .selectAll("rect")
    .data(bins, d => `${d.x0}-${d.x1}`);

  bars.exit().transition().duration(280).attr("height", 0).attr("y", y(0)).remove();

  bars.transition().duration(600)
    .attr("x", d => x(d.x0) + 1)
    .attr("y", d => y(d.length))
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr("height", d => y(0) - y(d.length))
    .attr("fill", "#0f766e")
    .attr("opacity", 0.8);

  bars.enter()
    .append("rect")
    .attr("x", d => x(d.x0) + 1)
    .attr("y", y(0))
    .attr("width", d => Math.max(0, x(d.x1) - x(d.x0) - 2))
    .attr("height", 0)
    .attr("fill", "#0f766e")
    .attr("opacity", 0.8)
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>Price Bin</strong><br>$${fmt(d.x0)} - $${fmt(d.x1)}<br>Games: ${d.length}`);
    })
    .on("mouseleave", hideTooltip)
    .transition().duration(620)
    .attr("y", d => y(d.length))
    .attr("height", d => y(0) - y(d.length));
}

// ── summary line chart ──
function createSummaryChart() {
  setupSvg(summarySvg);
  const { width, height, g } = getChartArea(summarySvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("path").attr("class", "summary-line").attr("fill", "none").attr("stroke", "var(--summary-line)").attr("stroke-width", 2.6);
  g.append("g").attr("class", "summary-dots");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Release Year");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("Average Total Price (USD)");
}

// draws the yearly average total price as a smooth monotone line with dot markers
function updateSummary() {
  const { width, height, g } = getChartArea(summarySvg);
  const byYear = d3.rollups(
    state.filtered,
    v => ({ avgTotal: d3.mean(v, d => d.total_price) || 0, count: v.length }),
    d => d.release_year
  ).sort((a, b) => a[0] - b[0]);

  if (!byYear.length) {
    g.select(".summary-line").attr("d", null);
    g.select(".summary-dots").selectAll("circle").remove();
    g.select(".x-axis").call(d3.axisBottom(d3.scaleLinear().domain([0, 1]).range([0, width])));
    g.select(".y-axis").call(d3.axisLeft(d3.scaleLinear().domain([0, 1]).range([height, 0])));
    d3.select("#summaryMeta").text("No games match the current filters.");
    drawEmpty(g, width, height, "No data for current filters");
    return;
  }

  g.selectAll("text.empty-msg").remove();

  const totalGames = d3.sum(byYear, d => d[1].count);
  const avgOfAvg = d3.mean(byYear, d => d[1].avgTotal) || 0;
  d3.select("#summaryMeta").text(
    `${totalGames} games | Avg total price: $${fmt(avgOfAvg)} | Years shown: ${byYear[0][0]}-${byYear[byYear.length - 1][0]}`
  );

  const x = d3.scaleLinear().domain([d3.min(byYear, d => d[0]) - 0.2, d3.max(byYear, d => d[0]) + 0.2]).range([0, width]);
  const y = d3.scaleLinear().domain([0, (d3.max(byYear, d => d[1].avgTotal) || 1) * 1.12]).nice().range([height, 0]);

  g.select(".x-axis").transition().duration(600)
    .call(d3.axisBottom(x).ticks(Math.min(byYear.length, 10)).tickFormat(d3.format("d")));

  g.select(".y-axis").transition().duration(600)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d => `$${d3.format(",.0f")(d)}`));

  const line = d3.line().x(d => x(d[0])).y(d => y(d[1].avgTotal)).curve(d3.curveMonotoneX);
  g.select(".summary-line").datum(byYear).transition().duration(700).attr("d", line);

  const dots = g.select(".summary-dots").selectAll("circle").data(byYear, d => d[0]);

  dots.exit().transition().duration(220).attr("r", 0).remove();

  dots.transition().duration(620)
    .attr("cx", d => x(d[0]))
    .attr("cy", d => y(d[1].avgTotal))
    .attr("r", 4.3)
    .attr("fill", "var(--summary-dot)")
    .attr("stroke", "var(--summary-dot-stroke)")
    .attr("stroke-width", 1.2);

  dots.enter()
    .append("circle")
    .attr("cx", d => x(d[0]))
    .attr("cy", d => y(d[1].avgTotal))
    .attr("r", 0)
    .attr("fill", "var(--summary-dot)")
    .attr("stroke", "var(--summary-dot-stroke)")
    .attr("stroke-width", 1.2)
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>${d[0]}</strong><br>Avg Total: $${fmt(d[1].avgTotal)}<br>Games: ${d[1].count}`);
    })
    .on("mouseleave", hideTooltip)
    .transition().duration(520)
    .attr("r", 4.3);
}

// ── gpu dominance trend ──
function createGpuDominanceChart() {
  setupSvg(gpuDominanceSvg);
  const { width, height, g } = getChartArea(gpuDominanceSvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("path").attr("class", "dominance-line").attr("fill", "none").attr("stroke", "var(--gpu)").attr("stroke-width", 2.8);
  g.append("g").attr("class", "dominance-dots");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Release Year");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -44)
    .attr("text-anchor", "middle")
    .text("GPU Share of Total Cost (%)");
}

// renders gpu share percentage over time as a line chart with dots
function updateGpuDominance() {
  const { width, height, g } = getChartArea(gpuDominanceSvg);
  const byYear = d3.rollups(
    state.filtered,
    v => {
      const avgTotal = d3.mean(v, d => d.total_price) || 0;
      const avgGpu = d3.mean(v, d => d.gpu_price) || 0;
      const gpuPercent = avgTotal > 0 ? (avgGpu / avgTotal) * 100 : 0;
      return { gpuPercent, count: v.length };
    },
    d => d.release_year
  ).sort((a, b) => a[0] - b[0]);

  if (!byYear.length) {
    g.select(".dominance-line").attr("d", null);
    g.select(".dominance-dots").selectAll("circle").remove();
    g.select(".x-axis").call(d3.axisBottom(d3.scaleLinear().domain([0, 1]).range([0, width])));
    g.select(".y-axis").call(d3.axisLeft(d3.scaleLinear().domain([0, 1]).range([height, 0])));
    d3.select("#gpuDominanceMeta").text("No games match the current filters.");
    drawEmpty(g, width, height, "No data for current filters");
    return;
  }

  g.selectAll("text.empty-msg").remove();

  const avgGpuShare = d3.mean(byYear, d => d[1].gpuPercent) || 0;
  d3.select("#gpuDominanceMeta").text(
    `GPU share averaged ${d3.format(".1f")(avgGpuShare)}% across ${byYear.length} year(s). Higher percentages indicate GPUs dominate cost growth.`
  );

  const x = d3.scaleLinear().domain([d3.min(byYear, d => d[0]) - 0.2, d3.max(byYear, d => d[0]) + 0.2]).range([0, width]);
  const y = d3.scaleLinear().domain([0, 100]).range([height, 0]);

  g.select(".x-axis").transition().duration(600)
    .call(d3.axisBottom(x).ticks(Math.min(byYear.length, 10)).tickFormat(d3.format("d")));

  g.select(".y-axis").transition().duration(600)
    .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d3.format("d")(d)}%`));

  const line = d3.line().x(d => x(d[0])).y(d => y(d[1].gpuPercent)).curve(d3.curveMonotoneX);
  g.select(".dominance-line").datum(byYear).transition().duration(700).attr("d", line);

  const dots = g.select(".dominance-dots").selectAll("circle").data(byYear, d => d[0]);

  dots.exit().transition().duration(220).attr("r", 0).remove();

  dots.transition().duration(620)
    .attr("cx", d => x(d[0]))
    .attr("cy", d => y(d[1].gpuPercent))
    .attr("r", 4.3)
    .attr("fill", "var(--gpu)")
    .attr("stroke", "var(--card)")
    .attr("stroke-width", 1.2);

  dots.enter()
    .append("circle")
    .attr("cx", d => x(d[0]))
    .attr("cy", d => y(d[1].gpuPercent))
    .attr("r", 0)
    .attr("fill", "var(--gpu)")
    .attr("stroke", "var(--card)")
    .attr("stroke-width", 1.2)
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>${d[0]}</strong><br>GPU Share: ${d3.format(".1f")(d[1].gpuPercent)}%<br>Games: ${d[1].count}`);
    })
    .on("mouseleave", hideTooltip)
    .transition().duration(520)
    .attr("r", 4.3);
}

// ── shared helpers ──
// renders x and y axes, rotating x-tick labels for narrow bands
function drawBarAxes(g, x, y) {
  g.select(".x-axis").transition().duration(600).call(d3.axisBottom(x));

  const xTicks = g.select(".x-axis").selectAll("text")
    .attr("transform", "rotate(-18)")
    .style("text-anchor", "end");

  if (x.bandwidth && x.bandwidth() > 60) {
    xTicks.attr("transform", null).style("text-anchor", "middle");
  }

  g.select(".y-axis").transition().duration(600)
    .call(d3.axisLeft(y).ticks(6).tickFormat(d => `$${d3.format(",.0f")(d)}`));
}

function clearBarMarks(g) {
  g.select(".bars").selectAll("*").remove();
  g.select(".stack-layer").selectAll("*").remove();
}

// clears an svg and adds a margin-translated plot-area group sized to the element
function setupSvg(svg) {
  const node = svg.node();
  const width = Math.max(340, node.clientWidth || 700);
  const height = Math.max(300, node.clientHeight || 320);

  svg.selectAll("*").remove();
  svg.attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  svg.append("g")
    .attr("class", "plot-area")
    .attr("transform", `translate(${CHART_MARGINS.left},${CHART_MARGINS.top})`);
}

// returns inner { width, height, g } by subtracting chart margins from the viewBox
function getChartArea(svg) {
  const vb = svg.attr("viewBox").split(" ").map(Number);
  const fullW = vb[2];
  const fullH = vb[3];
  const width = fullW - CHART_MARGINS.left - CHART_MARGINS.right;
  const height = fullH - CHART_MARGINS.top - CHART_MARGINS.bottom;
  const g = svg.select(".plot-area");
  return { width, height, g };
}

function drawEmpty(g, width, height, msg) {
  const empty = g.selectAll("text.empty-msg").data([msg]);
  empty.join("text")
    .attr("class", "empty-msg")
    .attr("x", width / 2)
    .attr("y", height / 2)
    .text(d => d);
}

function showDataError(message) {
  d3.selectAll("svg.viz").each(function () {
    const svg = d3.select(this);
    const width = this.clientWidth || 700;
    const height = this.clientHeight || 320;
    svg.attr("viewBox", `0 0 ${width} ${height}`)
      .append("text")
      .attr("x", width / 2)
      .attr("y", height / 2)
      .attr("class", "empty-msg")
      .text(message);
  });
}

function showTooltip(event, html) {
  tooltip
    .style("opacity", 1)
    .attr("aria-hidden", "false")
    .html(html)
    .style("left", `${event.clientX + 14}px`)
    .style("top", `${event.clientY + 14}px`);
}

function hideTooltip() {
  tooltip.style("opacity", 0).attr("aria-hidden", "true");
}

function fmt(value) {
  return d3.format(",.2f")(value);
}

// updates compare button disabled states and the queue status label
function syncCompareUI() {
  const addToCompare = d3.select("#addToCompare");
  const clearCompare = d3.select("#clearCompare");
  const compareStatus = d3.select("#compareStatus");

  if (addToCompare.empty() || clearCompare.empty() || compareStatus.empty()) {
    return;
  }

  const alreadyAdded = state.selectedGame
    ? state.compareGames.some(game => isSameGame(game, state.selectedGame))
    : false;

  const canAdd = Boolean(state.selectedGame) && !alreadyAdded && state.compareGames.length < 2;
  addToCompare.property("disabled", !canAdd);
  clearCompare.property("disabled", state.compareGames.length === 0);

  if (!state.compareGames.length) {
    compareStatus.text("No games in compare queue (0/2)");
    return;
  }

  const labels = state.compareGames.map((d, i) => `${i === 0 ? "A" : "B"}: ${d.game_name} (${d.release_year})`);
  compareStatus.text(`${labels.join(" | ")} (${state.compareGames.length}/2)`);
}

// returns true when two row objects share the same game title and release year
function isSameGame(a, b) {
  if (!a || !b) {
    return false;
  }

  return a.game_name === b.game_name && a.release_year === b.release_year;
}

// returns 0 or 1 if the point is in the compare queue, -1 if absent
function getCompareIndex(d) {
  return state.compareGames.findIndex(game => isSameGame(game, d));
}

// produces a deterministic offset in [-amplitude/2, amplitude/2] for a game row
function getStableJitter(d, amplitude) {
  const key = `${d.game_name}|${d.release_year}`;
  const normalized = stringHash01(key);
  return (normalized - 0.5) * amplitude;
}

// fnv-1a-inspired 32-bit hash, normalised to a float in [0, 1]
function stringHash01(input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

// escapes html special characters before inserting strings into tooltip markup
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// tries each file candidate in order, returning parsed rows from the first that loads
async function loadCompatibleData(fileCandidates) {
  for (const fileName of fileCandidates) {
    try {
      const rows = await d3.csv(fileName, normalizeRow);
      if (rows.length) {
        return rows;
      }
    } catch {
      // keep trying candidates
    }
  }
  throw new Error("No compatible CSV loaded");
}

// maps a raw csv row to a normalized game object, inferring missing gpu price where possible
function normalizeRow(d) {
  const cpu_price = toNumber(d.cpu_price ?? d.matched_cpu_price);
  const ram_price = toNumber(d.ram_price ?? d.matched_ram_price);
  const total_price = toNumber(d.total_price ?? d.total_estimated_price);
  let gpu_price = toNumber(d.gpu_price ?? d.matched_gpu_price);

  // Recover rows where GPU price is missing but component totals are available.
  if (!Number.isFinite(gpu_price) && Number.isFinite(total_price) && Number.isFinite(cpu_price) && Number.isFinite(ram_price)) {
    const inferred = total_price - cpu_price - ram_price;
    if (Number.isFinite(inferred) && inferred >= -1) {
      gpu_price = Math.max(0, inferred);
    }
  }

  const gpuSource = d.gpu_brand || d.matched_gpu_chipset || d.rec_gpu_requirement || "";
  const ramSource = d.ram_gb ?? d.rec_ram_gb ?? d.matched_ram_size;

  return {
    game_name: d.game_name,
    release_year: toNumber(d.release_year),
    cpu_price,
    gpu_price,
    ram_price,
    total_price,
    gpu_brand: d.gpu_brand || inferGpuBrand(gpuSource),
    ram_gb: toNumber(ramSource)
  };
}

// coerces a csv string or number to a JS number, returning NaN if it cannot be parsed
function toNumber(value) {
  if (value == null) {
    return NaN;
  }

  if (typeof value === "number") {
    return value;
  }

  const cleaned = String(value).replace(/[^0-9.-]/g, "").trim();
  return cleaned ? +cleaned : NaN;
}

// guesses gpu vendor by matching known brand keywords in a free-text requirement string
function inferGpuBrand(text) {
  const t = String(text || "").toLowerCase();

  if (/nvidia|geforce|gtx|rtx|quadro|titan/.test(t)) {
    return "NVIDIA";
  }

  if (/amd|radeon|\brx\b|vega|firepro/.test(t)) {
    return "AMD";
  }

  if (/intel|arc|iris|uhd|hd graphics/.test(t)) {
    return "Intel";
  }

  return "Other";
}

// delays fn execution until 'delay' ms have elapsed since the last invocation
function debounce(fn, delay = 160) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function setupThemeToggle() {
  const toggle = document.getElementById("themeToggle");
  if (!toggle) {
    return;
  }

  const storageKey = "dashboard-theme";
  const savedTheme = localStorage.getItem(storageKey);
  const systemPrefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const initialTheme = savedTheme === "dark" || savedTheme === "light"
    ? savedTheme
    : (systemPrefersDark ? "dark" : "light");

  const applyTheme = theme => {
    document.documentElement.setAttribute("data-theme", theme);
    const isDark = theme === "dark";
    toggle.setAttribute("aria-pressed", String(isDark));
    toggle.textContent = isDark ? "Light Mode" : "Dark Mode";
    toggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
  };

  applyTheme(initialTheme);

  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(storageKey, next);
  });
}

function setupCardExpandControls() {
  const buttons = d3.selectAll(".card-expand-btn");
  if (buttons.empty()) {
    return;
  }

  buttons.on("click", function () {
    const card = this.closest(".card");
    if (!card) {
      return;
    }

    const isAlreadyFloating = card.classList.contains("card-floating");

    if (floatingCard && floatingCard !== card) {
      collapseFloatingCard(floatingCard);
    }

    if (isAlreadyFloating) {
      collapseFloatingCard(card);
      floatingCard = null;
    } else {
      card.classList.add("card-floating");
      floatingCard = card;
      document.body.classList.add("chart-focus-active");
      syncExpandButtons();
      positionFloatingCard(card);
    }

    window.dispatchEvent(new Event("resize"));
  });

  window.addEventListener("resize", debounce(() => {
    if (floatingCard) {
      positionFloatingCard(floatingCard);
    }
  }, 90));

  window.addEventListener("keydown", event => {
    if (event.key === "Escape" && floatingCard) {
      collapseFloatingCard(floatingCard);
      floatingCard = null;
      window.dispatchEvent(new Event("resize"));
    }
  });

  syncExpandButtons();
}

function positionFloatingCard(card) {
  const mainPanel = document.querySelector(".main-panel");
  const stickyTime = document.querySelector(".sticky-time");

  if (!mainPanel || !stickyTime) {
    return;
  }

  const panelRect = mainPanel.getBoundingClientRect();
  const stickyRect = stickyTime.getBoundingClientRect();
  const topPadding = 16;
  const sidePadding = 8;

  const top = Math.max(stickyRect.bottom + 10, topPadding);
  const left = Math.max(topPadding, panelRect.left + sidePadding);
  const rightGap = Math.max(topPadding, window.innerWidth - panelRect.right + sidePadding);
  const width = Math.max(360, window.innerWidth - left - rightGap);
  const maxHeight = Math.max(340, window.innerHeight - top - 24);

  card.style.top = `${top}px`;
  card.style.left = `${left}px`;
  card.style.right = `${rightGap}px`;
  card.style.width = `${width}px`;
  card.style.height = `${Math.min(760, maxHeight)}px`;
}

function collapseFloatingCard(card) {
  card.classList.remove("card-floating");
  card.style.top = "";
  card.style.left = "";
  card.style.right = "";
  card.style.width = "";
  card.style.height = "";

  if (!document.querySelector(".card-floating")) {
    document.body.classList.remove("chart-focus-active");
  }

  syncExpandButtons();
}

function syncExpandButtons() {
  document.querySelectorAll(".card-expand-btn").forEach(btn => {
    const card = btn.closest(".card");
    const expanded = Boolean(card && card.classList.contains("card-floating"));
    btn.setAttribute("aria-pressed", String(expanded));
    btn.textContent = expanded ? "Close" : "Expand";
    btn.title = expanded ? "Close enlarged chart" : "Enlarge this chart";
  });
}

function setupIntroCard() {
  const header = document.getElementById("introCardHeader");
  if (!header) {
    return;
  }

  const card = header.closest(".intro-card");
  if (!card) {
    return;
  }

  header.setAttribute("role", "button");
  header.setAttribute("tabindex", "0");
  header.setAttribute("aria-expanded", "true");

  const toggleCard = () => {
    const collapsed = card.classList.toggle("collapsed");
    header.setAttribute("aria-expanded", String(!collapsed));
    setTimeout(() => window.dispatchEvent(new Event("resize")), 100);
  };

  header.addEventListener("click", toggleCard);
  header.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleCard();
    }
  });
}
