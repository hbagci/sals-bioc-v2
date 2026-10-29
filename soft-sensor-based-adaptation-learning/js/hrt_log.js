const HrtLog = {

    selected: new Set(),
    columns: [],

    // ═══════════════════════════════════════════════════════════════════════
    // SELECTION UI — which columns are log10-transformed before augmentation
    // ═══════════════════════════════════════════════════════════════════════

    render(host, columns, onStart) {
        this.columns = columns;

        host.innerHTML = '';

        const note = document.createElement('div');
        note.className = 'hrt-note';
        note.textContent = `Selected columns are log10-transformed before augmentation, so every downstream stage — bucketing, generation, the indicators and both models — runs on the transformed values. None are selected by default, so a default run reproduces the report. "${HrtConfig.HRT_COL}" should stay unchecked — it is the group label used to bin samples at 12, 10 and 8 h.`;
        host.appendChild(note);

        const grid = document.createElement('div');
        grid.className = 'hrt-log-grid';
        for (const c of columns) {
            const item = document.createElement('label');
            item.className = 'hrt-log-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = this.selected.has(c);
            cb.addEventListener('change', () => {
                if (cb.checked) this.selected.add(c);
                else this.selected.delete(c);
            });
            item.appendChild(cb);
            item.appendChild(document.createTextNode(c));
            grid.appendChild(item);
        }
        host.appendChild(grid);

        const actions = document.createElement('div');
        actions.className = 'hrt-log-actions';

        const all = document.createElement('button');
        all.className = 'btn-clear-all';
        all.textContent = 'Select all';
        all.addEventListener('click', () => {
            for (const c of columns) this.selected.add(c);
            this.render(host, columns, onStart);
        });
        actions.appendChild(all);

        const none = document.createElement('button');
        none.className = 'btn-clear-all';
        none.textContent = 'Select none';
        none.addEventListener('click', () => {
            this.selected.clear();
            this.render(host, columns, onStart);
        });
        actions.appendChild(none);

        const start = document.createElement('button');
        start.className = 'btn-generate btn-hrt-start';
        start.id = 'hrt-start';
        start.textContent = 'Start';
        start.addEventListener('click', onStart);
        actions.appendChild(start);

        const status = document.createElement('span');
        status.className = 'stats-info';
        status.id = 'hrt-start-status';
        actions.appendChild(status);

        host.appendChild(actions);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // TRANSFORM — applied to the real rows before they reach the generator
    // ═══════════════════════════════════════════════════════════════════════

    apply(rows) {
        if (!this.selected.size) return rows;
        return rows.map(r => {
            const out = Object.assign({}, r);
            for (const c of this.selected) {
                const v = Number(out[c]);
                if (isFinite(v)) out[c] = Math.log10(Math.max(v, 1e-9));
            }
            return out;
        });
    },

    status(text) {
        const el = document.getElementById('hrt-start-status');
        if (el) el.textContent = text;
    },

    setBusy(busy) {
        const btn = document.getElementById('hrt-start');
        if (btn) btn.disabled = busy;
    },
};
