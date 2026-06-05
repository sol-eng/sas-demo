# Mixed Effects Analysis — Shiny for Python

Python port of the R Shiny app in `../shiny-R`. It generates clinical-trial-style
data, fits a mixed-effects model in **SAS Viya** via [`saspy`](https://sassoftware.github.io/saspy/),
and visualises the residuals with [`plotnine`](https://plotnine.org/).

Unlike the R version, this app talks to SAS **directly through `saspy`** — there
is no `reticulate` / `sasquatch` bridge.

## Layout

| File | Purpose |
|------|---------|
| `app.py` | The Shiny for Python application (UI + server). |
| `sascfg_personal.py` | SAS connection profiles (`ssh`, `viya`). |
| `requirements.txt` | Python dependencies. |

## Setup

```bash
cd shiny-python
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Authentication

The Viya connection uses a Posit Workbench OAuth token. Set the audience if it
differs from the default:

```bash
export WORKBENCH_AUDIENCE="<your-viya-audience-guid>"
```

`app.py` sets `SASPY_CONFIG` to the bundled `sascfg_personal.py` automatically.

## Run

```bash
shiny run app.py
```

Then open the printed URL (default <http://127.0.0.1:8000>).

## Notes

- The SAS Viya session is opened **once at startup** and shared across user
  sessions.
- Random number streams differ between R and Python, so generated data will not
  be bit-identical to the R app, but the structure and model are equivalent.
- The `PROC HPMIXED` program is unchanged from the R version.

# Mixed Effects Analysis — R Shiny

An R Shiny app that generates clinical-trial-style data, fits a mixed-effects
model in **SAS Viya**, and visualises the residuals with **ggplot2**.

SAS is reached from R through [`sasquatch`](https://github.com/posit-dev/sasquatch),
which in turn drives the Python [`saspy`](https://sassoftware.github.io/saspy/)
client via [`reticulate`](https://rstudio.github.io/reticulate/). A Python
port that talks to `saspy` directly (no `reticulate`/`sasquatch`) lives in
`../shiny-python`.

## Layout

| File | Purpose |
|------|---------|
| `app.R` | The Shiny application (UI + server). |
| `sascfg_personal.py` | SAS connection profiles (`ssh`, `viya`) used by `saspy`. |
| `requirements.txt` | Python dependencies for the reticulate virtualenv. |
| `renv.lock` | Pinned R package versions (restore with `renv::restore()`). |
| `manifest.json` | Deployment manifest for Posit Connect. |
| `.python-version` | Python version used by the reticulate environment. |

## Dependencies

### R packages

- `shiny`
- `tidyverse`
- `ggplot2`
- `sasquatch`
- `reticulate`

Restore the pinned versions with:

```r
renv::restore()
```

### Python environment

`saspy` and its dependencies live in a Python virtualenv that `reticulate`
drives. You can create it with either `reticulate` or `uv`.

**Option A — reticulate**

```r
library(reticulate)
virtualenv_create("r-saspy", requirements = "requirements.txt")
```

This creates the env under `~/.virtualenvs/r-saspy`.

**Option B — uv** (faster, recommended)

```bash
uv venv ~/.virtualenvs/r-saspy
uv pip install --python ~/.virtualenvs/r-saspy/bin/python -r requirements.txt
```

## Environment variables

On **Posit Workbench**, set the following two variables (e.g. in `.Renviron`)
so the app can find the Python env and request the correct Viya OAuth token:

```bash
# Point reticulate at the venv's Python interpreter created above
RETICULATE_PYTHON="~/.virtualenvs/r-saspy/bin/python"

# Viya OAuth audience/resource GUID used to mint the Workbench token
WORKBENCH_VIYA_RESOURCE="<your-viya-resource-guid>"
```

- `RETICULATE_PYTHON` must point at the `bin/python` inside the virtualenv you
  created above. If you used a different venv name or path, adjust accordingly.
- `WORKBENCH_VIYA_RESOURCE` is read by `get_fresh_token()` in `app.R`; the app
  errors at startup if it is not set when running on Workbench.

On **Posit Connect**, the token is obtained via `connectcreds::connect_viewer_token()`
and neither variable above is required.

## Run

From R / RStudio / Positron:

```r
shiny::runApp()
```

The app establishes the SAS Viya session **once** (showing a connection splash),
then lets you choose the number of studies and click **Run Analysis** to
generate data, fit `PROC HPMIXED`, and render the residuals histogram.

## Notes

- The SAS/Viya connection is established only once, even across multiple user
  sessions, and is closed on app shutdown via `onStop()`.
- The `PROC HPMIXED` program is identical to the one used in the Python port.
