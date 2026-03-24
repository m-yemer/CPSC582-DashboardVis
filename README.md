# CPSC582 Dashboard Visualization

Interactive D3 dashboard for Steam game hardware pricing trends.

Live dashboard: [https://m-yemer.github.io/CPSC582-DashboardVis/](https://m-yemer.github.io/CPSC582-DashboardVis/steam_hardware_dashboard/index.html)

## Run Locally

1. Open `steam_hardware_dashboard/index.html` in a browser.
2. Ensure `games_all_optimized_cpu_matching.csv` is available at the repository root.

## Observable Reference Samples

- Scatter plot (Total Hardware Cost Over Time): https://observablehq.com/@d3/scatterplot
- Grouped bars (Average Component Cost by Year, grouped mode): https://observablehq.com/@d3/grouped-bar-chart
- Stacked bars (Average Component Cost by Year, stacked mode): https://observablehq.com/@d3/stacked-bar-chart
- Histogram (Total Price Distribution): https://observablehq.com/@d3/histogram
- Line chart (Yearly Summary): https://observablehq.com/@d3/line-chart

- Time slider pattern (single slider): https://observablehq.com/@observablehq/input-range
- Dropdown filter pattern (select menu): https://observablehq.com/@observablehq/input-select
- Search input pattern (dataset search): https://observablehq.com/@observablehq/input-search
- Observable Inputs overview (all controls): https://observablehq.com/documentation/inputs/overview

## Calculation References

References for the core calculations used in this dashboard:

- Mean and median (used for metric cards and yearly averages): https://d3js.org/d3-array/summarize
- Group + reduce by year with `rollups` (used in bar and summary charts): https://d3js.org/d3-array/group
- Histogram binning with `bin` and thresholds: https://d3js.org/d3-array/bin
- Stacked bars with `stack`: https://d3js.org/d3-shape/stack
- Yearly trend line path generation with `line`: https://d3js.org/d3-shape/line
- Frontier baseline with per-year minimum via `min`: https://d3js.org/d3-array/summarize

Formula references used in the metrics:

- Percent change / annualized trend idea (used for yearly trend metric): https://en.wikipedia.org/wiki/Relative_change_and_difference
- Share of total (used for GPU share metric): https://en.wikipedia.org/wiki/Ratio

## Project Files

- `steam_hardware_dashboard/index.html`: Dashboard layout and styles.
- `steam_hardware_dashboard/dashboard.js`: Data loading, filtering, interactions, and D3 charts.
- `games_all_optimized_cpu_matching.csv`: Source dataset.
