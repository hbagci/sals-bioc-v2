const HrtConfig = {

    // ── Column names (must match the HRT CSVs verbatim) ─────────────────────
    HRT_COL: 'HRT (h)',
    CELLS:   'Total cells (cell/ml)',
    COD:     'COD (mg/l)',

    // ── Already-log10 cell counts ───────────────────────────────────────────
    // A real total-cell count is >= 1e3 cell/ml; a log10-transformed column
    // sits near 6-9, so a cells column whose maximum is below this is taken
    // as already log-transformed and the LRV becomes a plain difference.
    CELLS_LOG10_MAX: 100,

    // ── HRT levels (plots draw them 12 → 8 on a reversed axis) ──────────────
    LEVELS:   [8, 10, 12],
    X_RANGE:  [12.6, 7.4],
    HIST_MIN: 7.4,
    HIST_MAX: 12.65,
    HIST_BIN: 0.05,

    BOOTSTRAP: 500,
    SEED:      42,

    // ── Palette (same colour-blind-safe set as the report figures) ──────────
    CLR: {
        real:     '#000000',
        synth:    '#0072B2',
        lstm:     '#D55E00',
        lifelong: '#009E73',
        levels:   { 8: '#009E73', 10: '#D55E00', 12: '#0072B2' },
    },

    SIDE_LABEL: { left: 'Influent', right: 'Effluent' },

    // ── Generation defaults (HRT_Report.docx section 2) ─────────────────────
    GEN_DEFAULTS: {
        num_steps:               3000,
        num_augmented_samples:   300,
        noise_level:             0.005,
        adaptive_bucketing:      true,
        max_state_ratio:         0.1,
        max_buckets_per_feature: 1000,
        num_buckets:             15,
        decoder_mode:            'local',
    },

    // ── Model development defaults (HRT_Report.docx section 2) ──────────────
    MODEL_DEFAULTS: {
        epochs:                  50,
        batch_size:              30,
        learning_rate:           0.001,
        early_stopping_patience: 10,
        train_ratio:             0.8,
        contamination:           0.05,
        adaptation_batch_size:   30,
        mu:                      6e-4,
        lam:                     1e-4,
        beta:                    2e-4,
        k:                       4,
    },

    // ── The three cross-membrane transfers ──────────────────────────────────
    // `cod_inf` is deliberately reversed: OLR has no effluent term, so filling
    // the effluent would leave the model-development OLR a copy of the
    // synthetic one.
    TRANSFERS: [
        { key: 'cells',   source: 'left',  target: 'right', column: 'Total cells (cell/ml)',
          indicator: 'LRV',         label: 'Effluent total cells  (influent → effluent)' },
        { key: 'cod_eff', source: 'left',  target: 'right', column: 'COD (mg/l)',
          indicator: 'COD removal', label: 'Effluent COD  (influent → effluent)' },
        { key: 'cod_inf', source: 'right', target: 'left',  column: 'COD (mg/l)',
          indicator: 'OLR',         label: 'Influent COD  (effluent → influent)' },
    ],

    // ── Indicator metadata ──────────────────────────────────────────────────
    INDICATORS: {
        LRV:           { field: 'lrv',         sd: 'lrv_sd',         ylabel: 'LRV (log10)',
                         title: 'LRV against HRT',                   unit: 'LRV' },
        'COD removal': { field: 'cod_removal', sd: 'cod_removal_sd', ylabel: 'COD removal (%)',
                         title: 'COD removal efficiency against HRT', unit: 'COD removal (%)' },
        OLR:           { field: 'olr',         sd: 'olr_sd',         ylabel: 'OLR (g COD / L / d)',
                         title: 'OLR against HRT',                   unit: 'OLR (g COD / L / d)' },
    },

    // ── EMCM-PS parameter schema, cloned from Config with report defaults ───
    genSchema() {
        const base = Config.algorithms.emcm_ps;
        return {
            label:       'EMCM-PS — emcm_ps.py',
            description: base.description,
            params: base.params.map(f => (
                f.key in this.GEN_DEFAULTS
                    ? { ...f, default: this.GEN_DEFAULTS[f.key] }
                    : { ...f }
            )),
        };
    },
};
