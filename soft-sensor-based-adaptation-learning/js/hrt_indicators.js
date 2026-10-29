const HrtIndicators = {

    // ── Seeded PRNG (same Lehmer generator as DimReduction) ─────────────────
    _rng(seed) {
        let s = seed;
        return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    },

    // ── Grouping — evaluation only, never written back into the rows ────────
    group(v) {
        const levels = HrtConfig.LEVELS;
        let best = levels[0], bestD = Math.abs(v - levels[0]);
        for (const l of levels) {
            const d = Math.abs(v - l);
            if (d < bestD) { best = l; bestD = d; }
        }
        return best;
    },

    groups(values) { return values.map(v => this.group(v)); },

    at(values, groups, level) {
        const out = [];
        for (let i = 0; i < values.length; i++) if (groups[i] === level) out.push(values[i]);
        return out;
    },

    mean(a) {
        let s = 0;
        for (const v of a) s += v;
        return s / a.length;
    },

    // ── Indicator formulas (port of emcm_runner.py STAGE C) ─────────────────
    lrv(mi, me)        { return Math.log10(Math.max(mi, 1)) - Math.log10(Math.max(me, 1)); },
    lrvOfLogs(mi, me)  { return mi - me; },

    // A cells column that is already log10 must not be logged twice.
    cellsAreLog10(...arrays) {
        let max = -Infinity;
        for (const a of arrays) for (const v of a) if (isFinite(v) && v > max) max = v;
        return isFinite(max) && max < HrtConfig.CELLS_LOG10_MAX;
    },

    lrvFn(isLog) { return isLog ? this.lrvOfLogs.bind(this) : this.lrv.bind(this); },
    codRemoval(mi, me) { return (mi - me) / mi * 100; },
    olr(codMgL, hrtH)  { return codMgL / 1000 / (hrtH / 24); },

    // ── Bootstrap sd of the indicator over resampled group means ────────────
    bootSd(fn, a, b) {
        const rnd = this._rng(HrtConfig.SEED);
        const vals = [];
        for (let k = 0; k < HrtConfig.BOOTSTRAP; k++) {
            let sa = 0, sb = 0;
            for (let i = 0; i < a.length; i++) sa += a[Math.floor(rnd() * a.length)];
            for (let i = 0; i < b.length; i++) sb += b[Math.floor(rnd() * b.length)];
            vals.push(fn(sa / a.length, sb / b.length));
        }
        return this._std(vals);
    },

    bootSdOlr(cod, level) {
        const rnd = this._rng(HrtConfig.SEED);
        const vals = [];
        for (let k = 0; k < HrtConfig.BOOTSTRAP; k++) {
            let s = 0;
            for (let i = 0; i < cod.length; i++) s += cod[Math.floor(rnd() * cod.length)];
            vals.push(this.olr(s / cod.length, level));
        }
        return this._std(vals);
    },

    _std(a) {
        const m = this.mean(a);
        let s = 0;
        for (const v of a) s += (v - m) * (v - m);
        return Math.sqrt(s / a.length);
    },

    // ── Column extraction from row-objects ──────────────────────────────────
    col(rows, name) { return rows.map(r => Number(r[name])); },

    /**
     * Per-HRT indicator table. `inf` / `eff` are row-object arrays.
     * `fill` optionally overrides the model-filled columns:
     *   { cellsEff, hrtEff, codEff, hrtCodEff, codInf, hrtCodInf }
     * Mirrors indicator_table() in HRT/scripts/emcm_runner.py.
     */
    table(label, inf, eff, fill) {
        const C = HrtConfig;
        fill = fill || {};

        const hrtIn   = this.col(inf, C.HRT_COL);
        const cellsIn = this.col(inf, C.CELLS);
        const codIn   = this.col(inf, C.COD);
        const gi      = this.groups(hrtIn);

        const cellsEff = fill.cellsEff || (eff ? this.col(eff, C.CELLS) : null);
        const hrtCells = fill.cellsEff ? fill.hrtEff : (eff ? this.col(eff, C.HRT_COL) : null);
        const codEff   = fill.codEff   || (eff ? this.col(eff, C.COD) : null);
        const hrtCod   = fill.codEff   ? fill.hrtCodEff : (eff ? this.col(eff, C.HRT_COL) : null);

        const olrCod = fill.codInf || (fill.partial ? null : codIn);
        const olrHrt = fill.codInf ? fill.hrtCodInf : hrtIn;
        const go     = olrCod ? this.groups(olrHrt) : null;

        const gCells = hrtCells ? this.groups(hrtCells) : null;
        const gCod   = hrtCod   ? this.groups(hrtCod)   : null;

        const cellsLog10 = cellsEff ? this.cellsAreLog10(cellsIn, cellsEff) : false;
        const lrvFn      = this.lrvFn(cellsLog10);

        const rows = C.LEVELS.map(l => {
            const ci = this.at(cellsIn, gi, l);
            const di = this.at(codIn,   gi, l);
            const row = {
                dataset:      label,
                hrt:          l,
                n_influent:   ci.length,
                mean_inf_cells: this.mean(ci),
                mean_inf_cod:   this.mean(di),
            };

            if (cellsEff) {
                const ce = this.at(cellsEff, gCells, l);
                row.n_effluent     = ce.length;
                row.mean_eff_cells = this.mean(ce);
                row.lrv            = lrvFn(this.mean(ci), this.mean(ce));
                row.lrv_sd         = this.bootSd(lrvFn, ci, ce);
            }
            if (codEff) {
                const de = this.at(codEff, gCod, l);
                row.mean_eff_cod   = this.mean(de);
                row.cod_removal    = this.codRemoval(this.mean(di), this.mean(de));
                row.cod_removal_sd = this.bootSd(this.codRemoval.bind(this), di, de);
            }
            if (olrCod) {
                const oc = this.at(olrCod, go, l);
                row.olr    = this.olr(this.mean(oc), l);
                row.olr_sd = this.bootSdOlr(oc, l);
            }
            return row;
        });

        rows.cellsLog10 = cellsLog10;
        return rows;
    },

    // ── HRT distribution numbers (mirrors generation_summary / hrt_drift) ───
    distribution(values) {
        const g = this.groups(values);
        const drift = values.map((v, i) => Math.abs(v - g[i]));
        const counts = {};
        for (const l of HrtConfig.LEVELS) counts[l] = 0;
        for (const l of g) counts[l] += 1;
        return {
            n:         values.length,
            counts,
            min:       Math.min(...values),
            max:       Math.max(...values),
            meanDrift: this.mean(drift),
            maxDrift:  Math.max(...drift),
        };
    },

    // ── Per-row indicator units for the model-development plots ─────────────
    // LRV and COD removal need a pair, so the source group mean is held fixed;
    // OLR is genuinely per-row.
    perRowLrv(cellsEff, hrtEff, infGroupMeanCells) {
        const means = Object.values(infGroupMeanCells);
        const fn    = this.lrvFn(this.cellsAreLog10(means, cellsEff));
        return cellsEff.map((v, i) => fn(infGroupMeanCells[this.group(hrtEff[i])], v));
    },

    perRowCodRemoval(codEff, hrtEff, infGroupMeanCod) {
        return codEff.map((v, i) => {
            const mi = infGroupMeanCod[this.group(hrtEff[i])];
            return (mi - v) / mi * 100;
        });
    },

    perRowOlr(codInf, hrtInf) {
        return codInf.map((v, i) => this.olr(v, this.group(hrtInf[i])));
    },

    groupMeanMap(values, hrt) {
        const g = this.groups(hrt);
        const out = {};
        for (const l of HrtConfig.LEVELS) out[l] = this.mean(this.at(values, g, l));
        return out;
    },
};
