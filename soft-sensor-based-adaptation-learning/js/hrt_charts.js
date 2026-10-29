const HrtCharts = {

    // ── Cell helpers ───────────────────────────────────────────────────────
    cell(container, cls) {
        const el = document.createElement('div');
        el.className = cls || 'lstm-chart-cell';
        container.appendChild(el);
        return el;
    },

    levelShapes() {
        return HrtConfig.LEVELS.map(l => ({
            type: 'line', x0: l, x1: l, y0: 0, y1: 1, yref: 'paper',
            line: { color: '#000000', width: 1.2, dash: 'dot' },
        }));
    },

    // ═══════════════════════════════════════════════════════════════════════
    // HRT DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════

    /** Step outline histogram — port of 05_plots.py::fig_hrt_drift */
    hrtHistogram(container, values, title, color) {
        const el = this.cell(container);
        const { HIST_MIN, HIST_MAX, HIST_BIN } = HrtConfig;

        const nBins = Math.round((HIST_MAX - HIST_MIN) / HIST_BIN);
        const counts = new Array(nBins).fill(0);
        for (const v of values) {
            const i = Math.floor((v - HIST_MIN) / HIST_BIN);
            if (i >= 0 && i < nBins) counts[i] += 1;
        }

        const xs = [HIST_MIN], ys = [0];
        for (let i = 0; i < nBins; i++) {
            xs.push(HIST_MIN + i * HIST_BIN, HIST_MIN + (i + 1) * HIST_BIN);
            ys.push(counts[i], counts[i]);
        }
        xs.push(HIST_MAX); ys.push(0);

        Plotly.newPlot(el, [
            { x: xs, y: ys, mode: 'lines', name: 'Generated',
              line: { color, width: 2 } },
        ], {
            ...Charts.PLOTLY_LAYOUT, height: 340,
            title: { text: title, font: { size: Charts.FS(12) } },
            xaxis: { title: 'Generated HRT (h)', range: HrtConfig.X_RANGE,
                     tickvals: HrtConfig.LEVELS, tickfont: { size: Charts.FS(9) } },
            yaxis: { title: 'Count', tickfont: { size: Charts.FS(9) } },
            shapes: this.levelShapes(),
        }, Charts.PLOTLY_CFG);
    },

    hrtDistTable(container, dist) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        const rows = HrtConfig.LEVELS.slice().reverse()
            .map(l => `<tr><td>${l} h</td><td>${dist.counts[l]}</td></tr>`).join('');
        wrap.innerHTML = `
            <table class="lstm-metrics-table">
                <tr><th>Quantity</th><th>Value</th></tr>
                ${rows}
                <tr><td>Total rows</td><td>${dist.n}</td></tr>
                <tr><td>HRT min</td><td>${Charts.fmt(dist.min, 3)}</td></tr>
                <tr><td>HRT max</td><td>${Charts.fmt(dist.max, 3)}</td></tr>
                <tr><td>Mean drift from level</td><td>${Charts.fmt(dist.meanDrift, 4)}</td></tr>
                <tr><td>Max drift from level</td><td>${Charts.fmt(dist.maxDrift, 4)}</td></tr>
            </table>`;
        container.appendChild(wrap);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // INDICATOR vs HRT  (report Figure 2/3/4, left panel)
    // ═══════════════════════════════════════════════════════════════════════

    /** series: [{ name, y:[…by LEVELS…], sd, color, dashed }] */
    indicatorVsHrt(container, series, title, ylabel) {
        const el = this.cell(container);
        const order = HrtConfig.LEVELS.slice().reverse();
        const idx   = order.map(l => HrtConfig.LEVELS.indexOf(l));

        const traces = series.map(s => ({
            x: order,
            y: idx.map(i => s.y[i]),
            error_y: s.sd
                ? { type: 'data', array: idx.map(i => s.sd[i]), visible: true,
                    color: s.color, thickness: 1.4, width: 5 }
                : { visible: false },
            mode: 'lines+markers', name: s.name,
            line:   { color: s.color, width: 2.4, dash: s.dashed ? 'dash' : 'solid' },
            marker: { size: 9, color: s.dashed ? '#ffffff' : s.color,
                      line: { color: s.color, width: 2 } },
        }));

        Plotly.newPlot(el, traces, {
            ...Charts.PLOTLY_LAYOUT, height: 400, showlegend: true,
            title: { text: title, font: { size: Charts.FS(12) } },
            xaxis: { title: 'HRT (h)', range: HrtConfig.X_RANGE,
                     tickvals: order, tickfont: { size: Charts.FS(9) } },
            yaxis: { title: ylabel, tickfont: { size: Charts.FS(9) } },
            legend: { orientation: 'h', x: 0, y: -0.18, font: { size: Charts.FS(9) } },
            margin: { l: 60, r: 20, t: 40, b: 80 },
        }, Charts.PLOTLY_CFG);
    },

    indicatorTable(container, rows, cols) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        const head = ['Dataset', ...HrtConfig.LEVELS.slice().reverse().map(l => `${l} h`)];
        const body = rows.map(r => {
            const cells = HrtConfig.LEVELS.slice().reverse()
                .map(l => Charts.fmt(r.values[l], cols.digits));
            return `<tr><td>${r.name}</td><td>${cells.join('</td><td>')}</td></tr>`;
        }).join('');
        wrap.innerHTML = `
            <table class="lstm-metrics-table">
                <tr><th>${head.join('</th><th>')}</th></tr>
                ${body}
            </table>`;
        container.appendChild(wrap);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // MODEL DEVELOPMENT PLOTS
    // ═══════════════════════════════════════════════════════════════════════

    /** Per-sample line graph, rows ordered 12 h → 10 h → 8 h with dividers. */
    predictionLine(container, actual, predicted, levels, title, ylabel) {
        const el = this.cell(container);
        const order = HrtConfig.LEVELS.slice().reverse();

        const ordIdx = [];
        const bounds = [];
        for (const l of order) {
            for (let i = 0; i < levels.length; i++) if (levels[i] === l) ordIdx.push(i);
            bounds.push({ level: l, end: ordIdx.length });
        }

        const shapes = [], annotations = [];
        let start = 0;
        for (const b of bounds) {
            annotations.push({
                x: (start + b.end) / 2, y: 1.06, yref: 'paper', xanchor: 'center',
                text: `${b.level} h`, showarrow: false,
                font: { size: Charts.FS(10), color: HrtConfig.CLR.levels[b.level] },
            });
            if (b.end < ordIdx.length) {
                shapes.push({ type: 'line', x0: b.end, x1: b.end, y0: 0, y1: 1, yref: 'paper',
                              line: { color: '#7f8c8d', width: 1.2, dash: 'dash' } });
            }
            start = b.end;
        }

        Plotly.newPlot(el, [
            { y: ordIdx.map(i => actual[i]),    mode: 'lines', name: 'Actual',
              line: { color: '#2980b9', width: 1 } },
            { y: ordIdx.map(i => predicted[i]), mode: 'lines', name: 'Predicted',
              line: { color: '#e67e22', width: 1, dash: 'dash' } },
        ], {
            ...Charts.PLOTLY_LAYOUT, height: 340, showlegend: true,
            title: { text: title, font: { size: Charts.FS(12) } },
            xaxis: { title: 'Sample', tickfont: { size: Charts.FS(9) } },
            yaxis: { title: ylabel, tickfont: { size: Charts.FS(9) } },
            legend: { x: 0.70, y: 0.99, font: { size: Charts.FS(9) } },
            shapes, annotations,
        }, Charts.PLOTLY_CFG);
    },

    /** Actual vs predicted, one colour per HRT level, with the 1:1 line. */
    parityByHrt(container, actual, predicted, levels, title, axisLabel) {
        const el = this.cell(container);
        const all = actual.concat(predicted).filter(v => isFinite(v));
        const lo = Math.min(...all), hi = Math.max(...all);

        const traces = HrtConfig.LEVELS.slice().reverse().map(l => {
            const x = [], y = [];
            for (let i = 0; i < levels.length; i++) {
                if (levels[i] === l) { x.push(actual[i]); y.push(predicted[i]); }
            }
            return { type: 'scattergl', mode: 'markers', name: `${l} h`, x, y,
                     marker: { color: HrtConfig.CLR.levels[l], size: 4, opacity: 0.5 } };
        });
        traces.push({ type: 'scatter', mode: 'lines', showlegend: false,
                      x: [lo, hi], y: [lo, hi],
                      line: { color: '#2c3e50', dash: 'dash', width: 1.5 } });

        Plotly.newPlot(el, traces, {
            ...Charts.PLOTLY_LAYOUT, height: 400, showlegend: true,
            title: { text: title, font: { size: Charts.FS(12) } },
            xaxis: { title: `Actual ${axisLabel}`,    tickfont: { size: Charts.FS(9) } },
            yaxis: { title: `Predicted ${axisLabel}`, tickfont: { size: Charts.FS(9) } },
            legend: { x: 0.01, y: 0.99, font: { size: Charts.FS(9) } },
        }, Charts.PLOTLY_CFG);
    },

    /** Report Figure 5 — RMSE per batch (log) and R² per batch (symlog). */
    adaptationCurve(container, batchMetrics, title) {
        const grid = document.createElement('div');
        grid.className = 'chart-grid';
        container.appendChild(grid);

        const xs = batchMetrics.map((_, i) => i + 1);

        const rmseEl = this.cell(grid, 'chart-cell');
        Plotly.newPlot(rmseEl, [
            { x: xs, y: batchMetrics.map(b => b.rmse), mode: 'lines+markers',
              line: { color: '#D55E00' }, marker: { size: 4 } },
        ], {
            ...Charts.PLOTLY_LAYOUT, height: 330,
            title: { text: `${title} — error per batch`, font: { size: Charts.FS(12) } },
            xaxis: { title: 'Adaptation batch', tickfont: { size: Charts.FS(9) } },
            yaxis: { title: 'RMSE', type: 'log', tickfont: { size: Charts.FS(9) } },
        }, Charts.PLOTLY_CFG);

        const symlog = v => Math.sign(v) * Math.log10(1 + Math.abs(v));
        const ticks  = [-10000, -1000, -100, -10, -1, 0, 1];

        const r2El = this.cell(grid, 'chart-cell');
        Plotly.newPlot(r2El, [
            { x: xs, y: batchMetrics.map(b => symlog(b.r2)), mode: 'lines+markers',
              line: { color: '#0072B2' }, marker: { size: 4 },
              customdata: batchMetrics.map(b => b.r2),
              hovertemplate: 'batch %{x}<br>R² %{customdata:.3f}<extra></extra>' },
        ], {
            ...Charts.PLOTLY_LAYOUT, height: 330,
            title: { text: `${title} — R² per batch (symlog)`, font: { size: Charts.FS(12) } },
            xaxis: { title: 'Adaptation batch', tickfont: { size: Charts.FS(9) } },
            yaxis: { title: 'R²', tickmode: 'array',
                     tickvals: ticks.map(symlog), ticktext: ticks.map(String),
                     tickfont: { size: Charts.FS(9) } },
            shapes: [{ type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 0, y1: 0,
                       line: { color: '#000000', width: 1, dash: 'dot' } }],
        }, Charts.PLOTLY_CFG);
    },

    metricsTable(container, rows, showBefore) {
        const wrap = document.createElement('div');
        wrap.className = 'table-wrap';
        const before = showBefore
            ? r => `<td>${Charts.fmt(r.r2_before, 3)}</td>`
            : () => '';
        const body = rows.map(r => `<tr>
            <td>${r.target}</td>
            ${before(r)}
            <td>${Charts.fmt(r.r2, 3)}</td>
            <td>${r.rmse.toExponential(3)}</td>
            <td>${r.mae.toExponential(3)}</td>
            <td>${r.n}</td></tr>`).join('');
        wrap.innerHTML = `
            <table class="lstm-metrics-table">
                <tr><th>Target</th>
                    ${showBefore ? '<th>R² before adapt</th><th>R² after adapt</th>' : '<th>R²</th>'}
                    <th>RMSE</th><th>MAE</th><th>Rows</th></tr>
                ${body}
            </table>`;
        container.appendChild(wrap);
    },
};
