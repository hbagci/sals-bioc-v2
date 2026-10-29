class HrtModelSection {

    constructor(mode, mountEl) {
        this.mode    = mode;
        this.el      = mountEl;
        this.params  = { ...HrtConfig.MODEL_DEFAULTS };
        this.results = {};
        this.busy    = false;
        this._table  = null;
        this._build();
    }

    get color() { return HrtConfig.CLR[this.mode]; }
    get title()  { return this.mode === 'lstm' ? 'LSTM' : 'Lifelong-LSTM'; }

    // ── UI construction ────────────────────────────────────────────────────

    _build() {
        this.el.innerHTML = '';

        this._paramsBlock = this._block('① Parameters', true);
        this._plotsBlock  = this._block('② Plots & Metrics', true);
        this.el.appendChild(this._paramsBlock.details);
        this.el.appendChild(this._plotsBlock.details);

        this._populateParams();
        this._renderPlaceholder('Generate both sides, then run the transfers.');
    }

    _block(title, startOpen) {
        const details = document.createElement('details');
        details.className = 'lstm-block';
        details.open = startOpen;

        const summary = document.createElement('summary');
        summary.className = 'lstm-block-summary';
        const t = document.createElement('span');
        t.className = 'lstm-block-title';
        t.textContent = title;
        summary.appendChild(t);
        details.appendChild(summary);

        const body = document.createElement('div');
        body.className = 'lstm-block-body';
        details.appendChild(body);

        return { details, body };
    }

    _populateParams() {
        const body = this._paramsBlock.body;

        const trainDefs = [
            ['epochs', 'Epochs'],
            ['batch_size', 'Batch size'],
            ['learning_rate', 'Learning rate'],
            ['early_stopping_patience', 'Early stop patience'],
            ['train_ratio', 'Train ratio (source)'],
            ['contamination', 'Contamination'],
        ];
        body.appendChild(this._paramGroup('Training', trainDefs));

        if (this.mode === 'lifelong') {
            body.appendChild(this._paramGroup('Lifelong (ELLA)', [
                ['mu', 'μ'], ['lam', 'λ'], ['beta', 'β'], ['k', 'Shared components k'],
            ]));
            body.appendChild(this._paramGroup('Adaptation', [
                ['adaptation_batch_size', 'Adaptation batch size'],
            ]));
        }

        const note = document.createElement('div');
        note.className = 'hrt-note';
        note.textContent = this.mode === 'lstm'
            ? 'Trained on the source side and applied straight to the target side, with the source-fitted scaler. This is the plain cross-membrane baseline.'
            : 'Trained on the source side, then adapted prequentially on the target side in batches: predict a batch, then fit on it. Defaults are the simulator lifelong configuration.';
        body.appendChild(note);

        const bar = document.createElement('div');
        bar.className = 'hrt-run-bar';

        this._runBtn = document.createElement('button');
        this._runBtn.className = 'hrt-run-btn';
        this._runBtn.style.background = this.color;
        this._runBtn.textContent = 'Run all three transfers';
        this._runBtn.disabled = true;
        this._runBtn.addEventListener('click', () => this.runAll());
        bar.appendChild(this._runBtn);

        for (const t of HrtConfig.TRANSFERS) {
            const b = document.createElement('button');
            b.className = 'lstm-run-btn';
            b.dataset.transfer = t.key;
            b.textContent = t.indicator;
            b.disabled = true;
            b.addEventListener('click', () => this.runOne(t));
            bar.appendChild(b);
        }

        this._status = document.createElement('span');
        this._status.className = 'hrt-run-status';
        bar.appendChild(this._status);

        body.appendChild(bar);
    }

    _paramGroup(label, defs) {
        const group = document.createElement('div');
        group.className = 'lstm-param-group';

        const lbl = document.createElement('div');
        lbl.className = 'lstm-group-label';
        lbl.textContent = label;
        group.appendChild(lbl);

        const grid = document.createElement('div');
        grid.className = 'lstm-params-grid';
        for (const [key, text] of defs) {
            const field = document.createElement('label');
            field.className = 'lstm-param-field';
            const span = document.createElement('span');
            span.className = 'lstm-param-label';
            span.textContent = text;
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'lstm-param-input';
            input.value = this.params[key];
            input.addEventListener('input', () => {
                const v = parseFloat(input.value);
                if (isFinite(v)) this.params[key] = v;
            });
            field.appendChild(span);
            field.appendChild(input);
            grid.appendChild(field);
        }
        group.appendChild(grid);
        return group;
    }

    setEnabled(enabled) {
        this._runBtn.disabled = !enabled || this.busy;
        this.el.querySelectorAll('button[data-transfer]')
            .forEach(b => { b.disabled = !enabled || this.busy; });
    }

    // ── Runs ───────────────────────────────────────────────────────────────

    async runAll() {
        for (const t of HrtConfig.TRANSFERS) {
            if (!await this.runOne(t)) break;
        }
    }

    async runOne(transfer) {
        if (this.busy) return false;
        this.busy = true;
        this.setEnabled(false);
        this._status.classList.add('busy');
        this._status.textContent = `Running ${transfer.label}…`;

        try {
            const result = this.mode === 'lstm'
                ? await this._runLstm(transfer)
                : await this._runLifelong(transfer);
            this.results[transfer.key] = result;
            this._table = null;
            this._status.classList.remove('busy');
            this._status.textContent = `${transfer.indicator} done — R² ${Charts.fmt(result.metrics.r2, 3)}`;
            this.render();
            HrtApp.refreshIndicators();
            return true;
        } catch (err) {
            this._status.classList.remove('busy');
            this._status.textContent = '';
            this._plotsBlock.body.innerHTML =
                `<div class="error-msg"><strong>${transfer.label} failed:</strong> ${err.message}</div>`;
            return false;
        } finally {
            this.busy = false;
            this.setEnabled(HrtApp.bothGenerated());
        }
    }

    async _runLstm(t) {
        const sourceCsv = HrtApp.generatedCsv(t.source);
        const targetCsv = HrtApp.generatedCsv(t.target);

        const trained = await Generator.lstm(Config.api.endpoints.lstmTrain, {
            csv: sourceCsv,
            target_column: t.column,
            side: t.source,
            params: {
                epochs:                  this.params.epochs,
                batch_size:              this.params.batch_size,
                learning_rate:           this.params.learning_rate,
                early_stopping_patience: this.params.early_stopping_patience,
                contamination:           this.params.contamination,
                train_ratio:             this.params.train_ratio,
                apply_outlier_removal_test: false,
            },
        });

        const validated = await Generator.lstm(Config.api.endpoints.lstmValidate, {
            csv: targetCsv,
            target_column: t.column,
            side: t.source,
            model_id: trained.model_id,
            contamination: this.params.contamination,
            apply_outlier_removal_test: true,
            index_column: HrtConfig.HRT_COL,
        });

        const filled = this._floor(validated.y_pred, t.column);
        return {
            hrt:      validated.index_values,
            measured: validated.y_true,
            filled,
            before:   null,
            metrics:  HrtModelSection.metrics(validated.y_true, filled),
            batches:  null,
        };
    }

    async _runLifelong(t) {
        const sourceCsv = HrtApp.generatedCsv(t.source);
        const targetCsv = HrtApp.generatedCsv(t.target);

        const trained = await Generator.lifelong(Config.api.endpoints.lifelongTrain, {
            source_csv: sourceCsv,
            target_column: t.column,
            side: t.source,
            params: this.params,
        });

        const adapted = await Generator.lifelong(Config.api.endpoints.lifelongAdapt, {
            session_id: trained.session_id,
            target_csv: targetCsv,
            side: t.source,
            params: this.params,
            index_column: HrtConfig.HRT_COL,
        });

        const measured = adapted.adapted_fill.y_true;
        const filled   = this._floor(adapted.adapted_fill.y_pred, t.column);
        const before   = this._floor(adapted.zero_shot.y_pred, t.column);
        return {
            hrt:      adapted.index_values,
            measured,
            filled,
            before,
            metrics:  HrtModelSection.metrics(measured, filled),
            beforeMetrics: HrtModelSection.metrics(measured, before),
            batches:  adapted.batch_metrics,
        };
    }

    _floor(values, column) {
        const floor = column === HrtConfig.CELLS ? 1 : 0;
        return values.map(v => Math.max(v, floor));
    }

    static metrics(yTrue, yPred) {
        const n = yTrue.length;
        const mean = yTrue.reduce((a, b) => a + b, 0) / n;
        let ssRes = 0, ssTot = 0, absSum = 0;
        for (let i = 0; i < n; i++) {
            const e = yTrue[i] - yPred[i];
            ssRes += e * e;
            absSum += Math.abs(e);
            ssTot += (yTrue[i] - mean) * (yTrue[i] - mean);
        }
        return { r2: 1 - ssRes / ssTot, rmse: Math.sqrt(ssRes / n), mae: absSum / n, n };
    }

    // ── Render ─────────────────────────────────────────────────────────────

    _renderPlaceholder(msg) {
        this._plotsBlock.body.innerHTML = `<div class="lstm-placeholder">${msg}</div>`;
    }

    render() {
        const body = this._plotsBlock.body;
        body.querySelectorAll('.js-plotly-plot').forEach(el => Plotly.purge(el));
        body.innerHTML = '';

        const done = HrtConfig.TRANSFERS.filter(t => this.results[t.key]);
        if (done.length === 0) { this._renderPlaceholder('No transfer has been run yet.'); return; }

        HrtCharts.metricsTable(body, done.map(t => {
            const r = this.results[t.key];
            return {
                target: t.label,
                r2_before: r.beforeMetrics ? r.beforeMetrics.r2 : NaN,
                r2: r.metrics.r2, rmse: r.metrics.rmse, mae: r.metrics.mae, n: r.metrics.n,
            };
        }), this.mode === 'lifelong');

        for (const t of done) this._renderTransfer(body, t);
    }

    _renderTransfer(container, t) {
        const r    = this.results[t.key];
        const meta = HrtConfig.INDICATORS[t.indicator];

        const sec = Charts.section(container, `${t.indicator} — ${t.label}`);

        const actual = this._toIndicatorUnits(t, r.measured, r.hrt);
        const pred   = this._toIndicatorUnits(t, r.filled,   r.hrt);
        const levels = r.hrt.map(v => HrtIndicators.group(v));

        HrtCharts.predictionLine(sec, actual, pred, levels,
            `Predicted ${meta.unit} per sample`, meta.unit);
        HrtCharts.parityByHrt(sec, actual, pred, levels,
            `Predicted vs actual ${meta.unit}`, meta.unit);

        const series = HrtApp.indicatorSeries(t.indicator, [this.mode]);
        if (series.length) {
            HrtCharts.indicatorVsHrt(sec, series, meta.title, meta.ylabel);
        }

        if (r.batches) {
            HrtCharts.adaptationCurve(sec, r.batches, t.indicator);
        }
    }

    _toIndicatorUnits(t, values, hrt) {
        const inf = HrtApp.generatedRows('left');
        if (t.indicator === 'LRV') {
            const m = HrtIndicators.groupMeanMap(
                HrtIndicators.col(inf, HrtConfig.CELLS), HrtIndicators.col(inf, HrtConfig.HRT_COL));
            return HrtIndicators.perRowLrv(values, hrt, m);
        }
        if (t.indicator === 'COD removal') {
            const m = HrtIndicators.groupMeanMap(
                HrtIndicators.col(inf, HrtConfig.COD), HrtIndicators.col(inf, HrtConfig.HRT_COL));
            return HrtIndicators.perRowCodRemoval(values, hrt, m);
        }
        return HrtIndicators.perRowOlr(values, hrt);
    }

    // ── Indicator table built from the filled columns ───────────────────────

    indicatorTable(label) {
        if (this._table) return this._table;
        const inf = HrtApp.generatedRows('left');
        const c   = this.results.cells;
        const ce  = this.results.cod_eff;
        const ci  = this.results.cod_inf;
        if (!c && !ce && !ci) return null;

        this._table = HrtIndicators.table(label, inf, null, {
            partial:    true,
            cellsEff:   c  ? c.filled  : null,
            hrtEff:     c  ? c.hrt     : null,
            codEff:     ce ? ce.filled : null,
            hrtCodEff:  ce ? ce.hrt    : null,
            codInf:     ci ? ci.filled : null,
            hrtCodInf:  ci ? ci.hrt    : null,
        });
        return this._table;
    }
}
