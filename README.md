# SALS-BioC v2.0

**A soft-sensor based adaptation learning simulator for predicting bacterial concentrations in membrane bioreactors.**

SALS-BioC is an interactive, browser-based simulator that couples a synthetic data generator with adaptive soft-sensor models to predict biological contaminant concentrations from routine physicochemical water-quality measurements. It is built for limited wastewater datasets, where a synthetic augmentation step and a knowledge-based adaptation mechanism help models generalize across biologically independent replicates and process drift.

Version 2.0 extends [SALS-BioC v1.0](https://github.com/hbagci/sals-bioc) with adaptive bucketing in the EMCM-PS generator and an HRT experiment workflow for predictions across the membrane (influent and effluent) under changing hydraulic retention times.

The tool runs as a local web application dashboard, organized into the following workflows:

- **Synthetic data generation** — augment collected real samples [3] with the EMCM-PS generator (a Markov-chain model using a joint-state representation and probabilistic sampling), with fixed quantile buckets or adaptive bucketing (new in v2.0: the gaps between feature values are split largest first, as long as the number of joint states does not exceed a maximum state ratio times the dataset size). Inspect quality through marginal distributions, Pearson correlation heatmaps, PCA / t-SNE projections, and a fidelity scorecard. Export generated data as CSV.
- **LSTM soft-sensor** — train and test an LSTM to predict a selected target from process variables, validate on unseen data, and download trained models.
- **Lifelong-learning adaptation** — train a source-domain model, adapt it to an unseen target replicate, and track per-batch adaptation performance, with optional Bayesian hyperparameter optimization [1, 2].
- **HRT experiment** (`hrt.html`, new in v2.0) — generate synthetic influent and effluent data side by side, then run three cross-membrane transfers with the LSTM or the Lifelong-LSTM: effluent total cells and effluent COD from a model trained on the influent, and influent COD from a model trained on the effluent. The scaler is fitted on the source side and reused on the target side. The log removal value (LRV), COD removal and organic loading rate (OLR) are computed per HRT from the real, synthetic and predicted data, with bootstrap standard errors.
- **Algorithm validation comparison** (`compare.html`) — a standalone page that trains a Lifelong-LSTM on one synthetic source (EMCM-PS or a pre-generated WGAN CSV) and validates on another, across all source combinations, with scatter plots and R²/RMSE/MSE/MAE tables.

## Requirements

- Python 3.10+
- Dependencies listed in `requirements.txt` (Flask, NumPy, pandas, SciPy, scikit-learn, PyTorch, bayesian-optimization)

## Installation

```bash
pip install -r requirements.txt
```

## Usage

Start the server:

```bash
python soft-sensor-based-adaptation-learning/server.py
```

(or run `run.bat` on Windows), then open:

```
http://localhost:5000
```

Upload a numeric CSV, select the target column, adjust parameters, and run the generation, training, and adaptation steps from the dashboard. Use the links in the header (or navigate to `/hrt.html` and `/compare.html`) to open the HRT experiment and the algorithm validation comparison.

Alternatively, open `launcher.ipynb` in Jupyter or VS Code and run its cells to install the requirements and start the simulator.

## Project layout

| Path | Description |
|------|-------------|
| `emcm_ps.py` | EMCM-PS synthetic data generator (fixed and adaptive bucketing) |
| `lstm.py` | LSTM soft-sensor model |
| `lifelong_lstm.py` | Lifelong-learning adaptation model |
| `soft-sensor-based-adaptation-learning/` | Flask server and web interface (`index.html`, `hrt.html`, `compare.html`) |
| `launcher.ipynb` | Notebook that installs the requirements and starts the simulator |

## References

1. J. Chen, I. N'Doye, Y. Myshkevych, F. Aljehani, M. K. Monjed, T.-M. Laleg-Kirati, P.-Y. Hong, Viral particle prediction in wastewater treatment plants using nonlinear lifelong learning models, npj Clean Water 8 (2025) 1–13.
2. J. Chen, I. N'Doye, J. S. Medina, S. Shah, P.-Y. Hong, Model generalization paradigms for predicting viral particles and evaluating removal efficiencies in anaerobic membrane bioreactor plants, npj Emerging Contaminants 2 (10) (2026) 1–16.
3. M. Jumat, N. Hasan, P. Subramanian, C. Heberling, R.-R. Colwell, P.-Y. Hong, Membrane bioreactor-based wastewater treatment plant in Saudi Arabia: Reduction of viral diversity, load, and infectious capacity, Water 9 (2017) 534.

## License

This project is licensed under the [MIT License](LICENSE).
