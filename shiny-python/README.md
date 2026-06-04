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

This project uses [uv](https://docs.astral.sh/uv/). Create the environment and
install dependencies with:

```bash
cd shiny-python
uv venv
uv pip install -r requirements.txt
```

`uv venv` creates `.venv`; uv commands use it automatically. To run commands
outside of `uv run`, activate it with `source .venv/bin/activate`.

## Authentication

The Viya connection uses a Posit Workbench OAuth token. Set the audience if it
differs from the default:

```bash
export WORKBENCH_AUDIENCE="<your-viya-audience-guid>"
```

`app.py` sets `SASPY_CONFIG` to the bundled `sascfg_personal.py` automatically.

## Run

```bash
uv run shiny run app.py
```

Then open the printed URL (default <http://127.0.0.1:8000>).

## Notes

- The SAS Viya session is opened **once at startup** and shared across user
  sessions.
- Random number streams differ between R and Python, so generated data will not
  be bit-identical to the R app, but the structure and model are equivalent.
- The `PROC HPMIXED` program is unchanged from the R version.
