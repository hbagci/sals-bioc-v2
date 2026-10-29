const HrtApp = {

    real:      { left: null, right: null },
    realCols:  { left: null, right: null },
    realCsv:   { left: null, right: null },
    generated: { left: null, right: null },
    genCsv:    { left: null, right: null },
    tables:    { real: null, synth: null },
    panels:    {},
    paramPanels: {},
    models:    {},
    _genId:    { left: 0, right: 0 },
    _debounce: {},

    // ── Accessors used by HrtModelSection ──────────────────────────────────
    generatedRows(side) { return this.generated[side] ? this.generated[side].rows : null; },
    generatedCsv(side)  { return this.genCsv[side]; },
    bothGenerated()     { return !!(this.genCsv.left && this.genCsv.right); },

    // ═══════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════

    init() {
        document.getElementById('left-title').textContent  = 'Influent — EMCM-PS';
        document.getElementById('right-title').textContent = 'Effluent — EMCM-PS';

        for (const side of ['left', 'right']) {
            this.panels[side] = new Panel(side);
            this.paramPanels[side] = new ParamPanel(
                document.getElementById(`${side}-params`),
                HrtConfig.genSchema(),
                () => this._onParamChange(side));
            this._wireSide(side);
        }

        this.models.lstm     = new HrtModelSection('lstm',     document.getElementById('hrt-lstm-body'));
        this.models.lifelong = new HrtModelSection('lifelong', document.getElementById('hrt-lifelong-body'));

        const view = document.getElementById('hrt-view');
        view.addEventListener('change', () => this._applyView(view.value));
        this._applyView(view.value);

        this._renderDistribution('left');
        this._renderDistribution('right');
        this.refreshIndicators();
        this._renderLogSection();
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION — LOG10 TRANSFORM AND THE SINGLE START BUTTON
    // ═══════════════════════════════════════════════════════════════════════

    _renderLogSection() {
        const host = document.getElementById('hrt-log-body');
        if (!this.realCols.left || !this.realCols.right) {
            host.innerHTML = '<div class="placeholder">Load the influent and effluent CSVs above to choose which columns are log10-transformed.</div>';
            return;
        }
        const cols = this.realCols.left.filter(c => this.realCols.right.includes(c));
        HrtLog.render(host, cols, () => this.startAll());
    },

    async startAll() {
        HrtLog.setBusy(true);
        try {
            HrtLog.status('Generating influent…');
            await this._generate('left');
            HrtLog.status('Generating effluent…');
            await this._generate('right');
            if (!this.bothGenerated()) {
                HrtLog.status('Generation failed — see the panels above.');
                return;
            }
            HrtLog.status('Running LSTM…');
            await this.models.lstm.runAll();
            HrtLog.status('Running Lifelong-LSTM…');
            await this.models.lifelong.runAll();
            HrtLog.status('Done.');
        } finally {
            HrtLog.setBusy(false);
        }
    },

    _applyView(value) {
        document.body.classList.remove('hrt-both', 'hrt-influent', 'hrt-effluent');
        document.body.classList.add(`hrt-${value}`);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // REAL DATA
    // ═══════════════════════════════════════════════════════════════════════

    _wireSide(side) {
        const input   = document.getElementById(`${side}-file`);
        const name    = document.getElementById(`${side}-filename`);
        const info    = document.getElementById(`${side}-info`);
        const loading = document.getElementById(`${side}-real-loading`);

        input.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            name.textContent = file.name;
            loading.style.display = 'inline';
            try {
                const text = await file.text();
                const parsed = this._parse(text);
                this.realCsv[side]  = text;
                this.real[side]     = parsed.rows;
                this.realCols[side] = parsed.columns;
                info.textContent = `${parsed.rows.length} rows · ${parsed.columns.length} cols`;
                document.getElementById(`${side}-generate`).disabled = false;
                this.tables.real = null;
                this._renderLogSection();
            } catch (err) {
                console.error(`[${side}]`, err);
                alert(`Error loading ${HrtConfig.SIDE_LABEL[side]} data: ${err.message}`);
                this._clearReal(side);
            } finally {
                loading.style.display = 'none';
            }
        });

        document.getElementById(`${side}-clear`).addEventListener('click', () => {
            this._clearReal(side);
            this.panels[side].clear();
            this.generated[side] = null;
            this.genCsv[side]    = null;
            this.tables.synth    = null;
            document.getElementById(`${side}-generate`).disabled = true;
            document.getElementById(`${side}-download`).disabled = true;
            this._renderDistribution(side);
            this.refreshIndicators();
            this._renderLogSection();
        });

        document.getElementById(`${side}-generate`)
            .addEventListener('click', () => this._generate(side));

        document.getElementById(`${side}-download`).addEventListener('click', () => {
            const g = this.generated[side];
            if (!g) return;
            const blob = new Blob([this.genCsv[side]], { type: 'text/csv' });
            const url  = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `synthetic_hrt_${HrtConfig.SIDE_LABEL[side].toLowerCase()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        });
    },

    _parse(text) {
        const res = Papa.parse(text, { header: true, dynamicTyping: true, skipEmptyLines: true });
        if (!res.data || res.data.length === 0) throw new Error('Empty CSV');
        const columns = (res.meta.fields || []).filter(col =>
            res.data.some(row => {
                const v = typeof row[col] === 'string' ? parseFloat(row[col]) : Number(row[col]);
                return isFinite(v) && !isNaN(v);
            }));
        if (columns.length === 0) throw new Error('No numeric columns');
        if (!columns.includes(HrtConfig.HRT_COL)) {
            throw new Error(`Missing the "${HrtConfig.HRT_COL}" column`);
        }
        return { rows: res.data, columns };
    },

    _clearReal(side) {
        this.real[side]     = null;
        this.realCols[side] = null;
        this.realCsv[side]  = null;
        this.tables.real    = null;
        document.getElementById(`${side}-file`).value = '';
        document.getElementById(`${side}-filename`).textContent = 'No file selected';
        document.getElementById(`${side}-info`).textContent = '';
    },

    // ═══════════════════════════════════════════════════════════════════════
    // GENERATION
    // ═══════════════════════════════════════════════════════════════════════

    _onParamChange(side) {
        if (!document.getElementById(`${side}-auto`).checked || !this.realCsv[side]) return;
        clearTimeout(this._debounce[side]);
        this._debounce[side] = setTimeout(() => this._generate(side), 500);
    },

    async _generate(side) {
        if (!this.realCsv[side]) return;
        const params  = this.paramPanels[side].getValues();
        const content = document.getElementById(`${side}-content`);
        const loading = document.getElementById(`${side}-loading`);

        const myId = ++this._genId[side];
        loading.style.display = 'inline';

        try {
            const realRows = HrtLog.apply(this.real[side]);
            const csv = Generator.toCsv(this.realCols[side], realRows);
            const result = await Generator.run('emcm_ps', csv, params);
            if (myId !== this._genId[side]) return;

            this.generated[side] = result;
            this.genCsv[side]    = Generator.toCsv(result.columns, result.rows);
            this.tables.synth    = null;

            this.panels[side].setGenerated(result);
            await this.panels[side].render(realRows, this.realCols[side]);
            document.getElementById(`${side}-download`).disabled = false;

            this._renderDistribution(side);
            this.refreshIndicators();

        } catch (err) {
            console.error(`[${side}]`, err);
            content.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.purge(el));
            content.innerHTML = `<div class="error-msg"><strong>Generation failed:</strong> ${err.message}</div>`;
            document.getElementById(`${side}-download`).disabled = true;
        } finally {
            if (myId === this._genId[side]) loading.style.display = 'none';
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION — HRT DISTRIBUTION
    // ═══════════════════════════════════════════════════════════════════════

    _renderDistribution(side) {
        const host = document.querySelector(`#hrt-dist-section .hrt-side[data-side="${side}"]`);
        host.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.purge(el));
        host.innerHTML = '';

        const g = this.generated[side];
        if (!g) {
            host.innerHTML = `<div class="placeholder">No ${HrtConfig.SIDE_LABEL[side]} data generated yet.</div>`;
            return;
        }

        const values = HrtIndicators.col(g.rows, HrtConfig.HRT_COL);
        const sec = Charts.section(host, `${HrtConfig.SIDE_LABEL[side]} — generated HRT`);

        const note = document.createElement('div');
        note.className = 'hrt-note';
        note.textContent = 'Dotted lines are the real levels (12 / 10 / 8 h).';
        sec.appendChild(note);

        HrtCharts.hrtHistogram(sec, values,
            `Generated HRT values, ${HrtConfig.SIDE_LABEL[side].toLowerCase()}`,
            Charts.SYNTH[side]);
        HrtCharts.hrtDistTable(sec, HrtIndicators.distribution(values));
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SECTION — INDICATORS
    // ═══════════════════════════════════════════════════════════════════════

    _realTable() {
        if (this.tables.real) return this.tables.real;
        if (!this.real.left || !this.real.right) return null;
        this.tables.real = HrtIndicators.table('Real', this.real.left, this.real.right, null);
        return this.tables.real;
    },

    _synthTable() {
        if (this.tables.synth) return this.tables.synth;
        if (!this.bothGenerated()) return null;
        this.tables.synth = HrtIndicators.table(
            'Synthetic', this.generated.left.rows, this.generated.right.rows, null);
        return this.tables.synth;
    },

    /** Series for one indicator; `modes` limits which model sections appear. */
    indicatorSeries(indicator, modes) {
        const meta = HrtConfig.INDICATORS[indicator];
        const out  = [];

        const push = (name, table, color, dashed) => {
            if (!table) return;
            const y  = table.map(r => r[meta.field]);
            if (y.every(v => v === undefined)) return;
            out.push({ name, y, sd: table.map(r => r[meta.sd]), color, dashed });
        };

        push('Real', this._realTable(), HrtConfig.CLR.real, false);
        push('Synthetic', this._synthTable(), HrtConfig.CLR.synth, false);

        for (const mode of (modes || ['lstm', 'lifelong'])) {
            const section = this.models[mode];
            if (!section) continue;
            push(`Model development (${section.title})`,
                 section.indicatorTable(`Model development: ${section.title}`),
                 HrtConfig.CLR[mode], true);
        }
        return out;
    },

    refreshIndicators() {
        const host = document.getElementById('hrt-indicator-body');
        host.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.purge(el));
        host.innerHTML = '';

        const bothReal = this.real.left && this.real.right;
        if (!this.bothGenerated() && !bothReal) {
            host.innerHTML = '<div class="placeholder">Load and generate both sides to compute the indicators.</div>';
            this._setModelsEnabled();
            return;
        }

        const note = document.createElement('div');
        note.className = 'hrt-note';
        note.textContent = 'Indicators are computed from per-HRT group means — the influent and effluent are generated in independent runs, so row i of one is not the same sample as row i of the other. Error bars are the standard deviation of those means over 500 bootstrap resamples.';
        host.appendChild(note);

        const table = this._synthTable() || this._realTable();
        if (table && table.cellsLog10) {
            const logNote = document.createElement('div');
            logNote.className = 'hrt-note';
            logNote.textContent = `The "${HrtConfig.CELLS}" column is already log10-transformed, so the LRV is the influent-minus-effluent difference of the group means, not the difference of their logarithms.`;
            host.appendChild(logNote);
        }

        for (const key of ['LRV', 'COD removal', 'OLR']) {
            const meta   = HrtConfig.INDICATORS[key];
            const series = this.indicatorSeries(key, null);
            if (!series.length) continue;
            const sec = Charts.section(host, meta.title);
            HrtCharts.indicatorVsHrt(sec, series, meta.title, meta.ylabel);
            HrtCharts.indicatorTable(sec, series.map(s => ({
                name: s.name,
                values: Object.fromEntries(HrtConfig.LEVELS.map((l, i) => [l, s.y[i]])),
            })), { digits: 3 });
        }

        this._setModelsEnabled();
    },

    _setModelsEnabled() {
        const ok = this.bothGenerated();
        for (const m of Object.values(this.models)) m.setEnabled(ok);
    },
};

document.addEventListener('DOMContentLoaded', () => HrtApp.init());
