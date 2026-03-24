const CHART_MARGINS = { top: 34, right: 24, bottom: 52, left: 62 };
const COLORS = {
  cpu: "#2f80ed",
  gpu: "#eb5757",
  ram: "#27ae60"
};

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
  gpuDomain: []
};

const tooltip = d3.select("#tooltip");
const scatterSvg = d3.select("#scatterChart");
const barSvg = d3.select("#barChart");
const histSvg = d3.select("#histChart");
const summarySvg = d3.select("#summaryChart");

init();

async function init() {
  const preferredFiles = ["../games_all_optimized_cpu_matching.csv", "../steam_hardware.csv", "games_all_optimized_cpu_matching.csv", "steam_hardware.csv"];
  let loaded;

  try {
    loaded = await loadCompatibleData(preferredFiles);
  } catch {
    showDataError("Could not load data file. Expected games_all_optimized_cpu_matching.csv.");
    return;
  }

  state.raw = loaded.rows.filter(d =>
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

  d3.select(".subtitle").text("This project explores how Steam game hardware costs change over time. The goal is to compare CPU, GPU, and RAM trends and spot budget friendly setups.");

  state.gpuDomain = Array.from(new Set(state.raw.map(d => d.gpu_brand))).sort(d3.ascending);
  setupControls();
  createScatterPlot();
  createBarChart();
  createHistogram();
  createSummaryChart();
  updateCharts();

  window.addEventListener("resize", debounce(() => {
    createScatterPlot();
    createBarChart();
    createHistogram();
    createSummaryChart();
    updateCharts();
  }, 140));
}

function setupControls() {
  const yearMin = d3.select("#yearMin");
  const yearMax = d3.select("#yearMax");
  const yearRangeFill = d3.select("#yearRangeFill");
  const yearRangeLabel = d3.select("#yearRangeLabel");
  const gpuFilter = d3.select("#gpuFilter");
  const ramFilter = d3.select("#ramFilter");
  const gameSearch = d3.select("#gameSearch");
  const gameSuggestions = d3.select("#gameSuggestions");
  const showFrontier = d3.select("#showFrontier");

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

  d3.select("#clearSelection").on("click", () => {
    state.selectedGame = null;
    updateCharts();
  });

  syncYearRangeUI();
}

function updateCharts() {
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

  updateMetrics();

  updateScatter();
  updateBarChart();
  updateHistogram();
  updateSummary();
}

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
    const annualPct = ((last - first) / Math.max(1, first)) * (100 / years);
    trendText = `${annualPct >= 0 ? "+" : ""}${d3.format(".1f")(annualPct)}%/yr`;
  }

  countNode.text(d3.format(",")(count));
  medianNode.text(`$${fmt(medianTotal)}`);
  shareNode.text(`${d3.format(".1f")(medianGpuShare)}%`);
  trendNode.text(trendText);
}

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

  const frontier = d3.rollups(
    state.filtered,
    v => d3.min(v, d => d.total_price),
    d => d.release_year
  ).sort((a, b) => a[0] - b[0]);

  const frontierMap = new Map(frontier);
  const isNearFrontier = d => {
    const floor = frontierMap.get(d.release_year);
    return Number.isFinite(floor) && d.total_price <= floor * 1.12;
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

    scatterMeta.text("Scatter plot with lowest-cost line (dashed): minimum total price per year.");
  } else {
    g.select(".frontier-layer").selectAll("*").remove();
    scatterMeta.text("Scatter plot: point color by GPU brand; click a point to focus a game.");
  }

  const jitter = 0.3;
  const points = g.select(".marks")
    .selectAll("circle")
    .data(state.filtered, d => `${d.game_name}-${d.release_year}`);

  points.exit().transition().duration(320).attr("r", 0).remove();

  points.transition().duration(600)
    .attr("cx", d => x(d.release_year + (Math.random() - 0.5) * jitter))
    .attr("cy", d => y(d.total_price))
    .attr("fill", d => gpuColor(d.gpu_brand) || "#8e8e93")
    .attr("stroke", d => {
      if (state.selectedGame && d.game_name === state.selectedGame.game_name) {
        return "#111827";
      }
      if (state.showFrontier && isNearFrontier(d)) {
        return "#f59e0b";
      }
      return "#fff";
    })
    .attr("stroke-width", d => {
      if (state.selectedGame && d.game_name === state.selectedGame.game_name) {
        return 2.8;
      }
      if (state.showFrontier && isNearFrontier(d)) {
        return 2;
      }
      return 1.2;
    })
    .attr("opacity", d => state.selectedGame && d.game_name !== state.selectedGame.game_name ? 0.28 : 0.85)
    .attr("r", d => state.selectedGame && d.game_name === state.selectedGame.game_name ? 8.5 : 5.6);

  points.enter()
    .append("circle")
    .attr("cx", d => x(d.release_year + (Math.random() - 0.5) * jitter))
    .attr("cy", d => y(d.total_price))
    .attr("r", 0)
    .attr("fill", d => gpuColor(d.gpu_brand) || "#8e8e93")
    .attr("stroke", d => state.showFrontier && isNearFrontier(d) ? "#f59e0b" : "#fff")
    .attr("stroke-width", d => state.showFrontier && isNearFrontier(d) ? 2 : 1.1)
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
      state.selectedGame = d;
      updateCharts();
    })
    .transition()
    .duration(560)
    .attr("r", d => state.selectedGame && d.game_name === state.selectedGame.game_name ? 8.5 : 5.6);
}

function getGpuColorScale() {
  return d3.scaleOrdinal()
    .domain(state.gpuDomain)
    .range(d3.schemeTableau10);
}

function renderScatterLegend(gpuColor) {
  const legend = d3.select("#scatterLegend");
  const legendItems = [
    ...state.gpuDomain.map(brand => ({
      label: brand,
      color: gpuColor(brand),
      isLine: false
    })),
    {
      label: "Lowest-cost line",
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
    .style("border-color", d => d.isLine ? "transparent" : "rgba(0, 0, 0, 0.08)");
}

function createBarChart() {
  setupSvg(barSvg);
  const { width, height, g } = getChartArea(barSvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("g").attr("class", "bars");
  g.append("g").attr("class", "stack-layer");

  g.append("text")
    .attr("class", "axis-label")
    .attr("x", width / 2)
    .attr("y", height + 42)
    .attr("text-anchor", "middle")
    .text("Release Year / Selected Game");

  g.append("text")
    .attr("class", "axis-label")
    .attr("transform", "rotate(-90)")
    .attr("x", -height / 2)
    .attr("y", -46)
    .attr("text-anchor", "middle")
    .text("Price (USD)");
}

function updateBarChart() {
  const { width, height, g } = getChartArea(barSvg);
  const selectedComponents = ["cpu", "gpu", "ram"].filter(c => state.activeComponents.has(c));
  const activeSet = new Set(selectedComponents);

  let data;
  let xValues;
  let title = "Average Component Cost by Year";
  let meta = "Grouped bars show average CPU/GPU/RAM price per year.";

  if (state.selectedGame) {
    const s = state.selectedGame;
    data = [{ key: `${s.game_name} (${s.release_year})`, cpu: s.cpu_price, gpu: s.gpu_price, ram: s.ram_price, total: s.total_price }];
    xValues = data.map(d => d.key);
    title = `Selected Game Breakdown: ${s.game_name}`;
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

  meta = `${meta} Mode: ${state.barMode === "stacked" ? "Stacked" : "Grouped"}.`;
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
  const [xMin, xMax] = x.domain();
  const tickStart = Math.floor(xMin / 100) * 100;
  const tickEnd = Math.ceil(xMax / 100) * 100;
  const tickValues = d3.range(tickStart, tickEnd + 100, 100);

  g.select(".x-axis").transition().duration(600)
    .call(d3.axisBottom(x).tickValues(tickValues).tickFormat(d => `$${d3.format(",.0f")(d)}`));

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

function createSummaryChart() {
  setupSvg(summarySvg);
  const { width, height, g } = getChartArea(summarySvg);

  g.append("g").attr("class", "x-axis").attr("transform", `translate(0,${height})`);
  g.append("g").attr("class", "y-axis");
  g.append("path").attr("class", "summary-line").attr("fill", "none").attr("stroke", "#475467").attr("stroke-width", 2.6);
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
    .attr("fill", "#111827");

  dots.enter()
    .append("circle")
    .attr("cx", d => x(d[0]))
    .attr("cy", d => y(d[1].avgTotal))
    .attr("r", 0)
    .attr("fill", "#111827")
    .on("mousemove", (event, d) => {
      showTooltip(event, `<strong>${d[0]}</strong><br>Avg Total: $${fmt(d[1].avgTotal)}<br>Games: ${d[1].count}`);
    })
    .on("mouseleave", hideTooltip)
    .transition().duration(520)
    .attr("r", 4.3);
}

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadCompatibleData(fileCandidates) {
  for (const fileName of fileCandidates) {
    try {
      const rows = await d3.csv(fileName, normalizeRow);
      if (rows.length) {
        return { rows, source: fileName };
      }
    } catch {
      // keep trying candidates
    }
  }
  throw new Error("No compatible CSV loaded");
}

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

function debounce(fn, delay = 160) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}
