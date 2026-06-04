"""Mixed Effects Analysis - Residuals by Study (Shiny for Python).

Port of the R Shiny app. Talks to SAS Viya directly via saspy (no reticulate /
sasquatch layer needed). The SAS session is established once at app startup.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
from plotnine import (
    aes,
    element_text,
    geom_histogram,
    ggplot,
    labs,
    theme,
    theme_minimal,
)
from shiny import App, reactive, render, ui

import saspy
from dotenv import load_dotenv

# Load environment variables from a local .env file (if present).
load_dotenv()

# Point saspy at the config file shipped alongside this app, unless the user
# has already configured one via the environment.
os.environ.setdefault(
    "SASPY_CONFIG",
    os.path.join(os.path.dirname(__file__), "sascfg_personal.py"),
)


# ---------------------------------------------------------------------------
# SAS Viya connection
# ---------------------------------------------------------------------------
def get_fresh_token() -> str:
    """Request a fresh Viya OAuth token from Posit Workbench."""
    audience = os.environ.get("WORKBENCH_AUDIENCE")
    if not audience:
        raise RuntimeError(
            "WORKBENCH_AUDIENCE environment variable is not set; "
            "cannot request a Viya OAuth token."
        )

    from posit.workbench import Client

    client = Client()
    credentials = client.oauth.get_credentials(audience=audience)
    token = credentials["access_token"]

    if not token:
        raise RuntimeError(
            f"Workbench OAuth returned an empty access token for audience "
            f"'{audience}'."
        )
    return token


def connect_viya() -> "saspy.SASsession":
    """Open a SAS Viya session using a fresh OAuth token."""
    return saspy.SASsession(cfgname="viya", authtoken=get_fresh_token())


# Establish the SAS/Viya session once, at startup, shared across user sessions.
SAS = connect_viya()


# ---------------------------------------------------------------------------
# Data generation (port of the tidyverse pipeline)
# ---------------------------------------------------------------------------
def generate_study_data(n_studies: int, seed: int = 12345) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # expand_grid: study_id x site_id x subject_id x visit
    # Build in the same nesting order as the R version (study outermost, visit
    # innermost) so that the per-subject intercept repeats cleanly across the
    # 4 visits of each subject.
    grid = pd.MultiIndex.from_product(
        [
            range(1, n_studies + 1),  # study_id
            range(1, 3),  # site_id (1:2)
            range(1, 21),  # subject_id (1:20)
            range(1, 5),  # visit (1:4)
        ],
        names=["study_id", "site_id", "subject_id", "visit"],
    )
    df = grid.to_frame(index=False)

    n = len(df)

    df["unique_subject_id"] = (
        df["study_id"] * 100 + df["site_id"] * 20 + df["subject_id"]
    )

    # One intercept per distinct subject, repeated across that subject's visits.
    distinct_subjects = df["unique_subject_id"].drop_duplicates()
    intercepts = pd.Series(
        rng.normal(loc=0.0, scale=2.0, size=len(distinct_subjects)),
        index=distinct_subjects.values,
    )
    df["subject_intercept"] = df["unique_subject_id"].map(intercepts).to_numpy()

    df["age"] = rng.uniform(18, 75, n)
    df["gender"] = rng.binomial(1, 0.52, n)
    df["treatment"] = rng.binomial(1, 0.5, n)
    df["baseline_score"] = rng.normal(50, 10, n)
    df["study_effect"] = rng.normal(0, 1.5, n)
    df["site_effect"] = rng.normal(0, 1.0, n)
    df["time_trend"] = df["visit"] * 2.5
    df["treatment_effect"] = df["treatment"] * 8.3
    df["age_effect"] = (df["age"] - 45) * 0.2
    df["gender_effect"] = df["gender"] * 3.1
    df["error"] = rng.normal(0, 3.2, n)

    df["outcome"] = (
        45
        + df["time_trend"]
        + df["treatment_effect"]
        + df["age_effect"]
        + df["gender_effect"]
        + df["study_effect"]
        + df["site_effect"]
        + df["subject_intercept"]
        + df["error"]
    )

    # Introduce missingness (~5% outcome, ~2% age)
    df.loc[rng.uniform(size=n) < 0.05, "outcome"] = np.nan
    df.loc[rng.uniform(size=n) < 0.02, "age"] = np.nan

    # Derived labels
    df["age_group"] = np.select(
        [
            df["age"].isna(),
            df["age"] < 30,
            df["age"] < 50,
            df["age"] >= 50,
        ],
        ["Unknown", "Young", "Middle", "Older"],
        default="Unknown",
    )
    df["treatment_group"] = np.where(df["treatment"] == 1, "Active", "Placebo")
    df["gender_label"] = np.where(df["gender"] == 1, "Female", "Male")

    return df


# SAS PROC HPMIXED program (unchanged from the R app).
SAS_CODE = """
proc hpmixed data=study_data;
    performance threadlevelize;
    class unique_subject_id study_id treatment_group visit;
    model outcome = visit treatment_group visit*treatment_group /
          solution;
    random intercept / subject=unique_subject_id;
    random intercept / subject=study_id;
    random visit / subject=unique_subject_id type=ar(1);
    output out=mixed_results predicted=Pred residual=Resid;
    ods output ParameterEstimates=fixed_effects
               CovParms=variance_components;
run;
"""


# ---------------------------------------------------------------------------
# UI
# ---------------------------------------------------------------------------
app_ui = ui.page_sidebar(
    ui.sidebar(
        ui.input_select(
            "study_id",
            "Select number of studies:",
            choices=["1", "2", "5", "10", "20", "50"],
            selected="1",
        ),
        ui.input_action_button(
            "run_analysis", "Run Analysis", class_="btn-primary"
        ),
        ui.br(),
        ui.help_text(
            "Select a study ID and click 'Run Analysis' to generate data, "
            "run the mixed effects model in SAS, and display the residuals "
            "histogram."
        ),
    ),
    ui.navset_tab(
        ui.nav_panel("Histogram", ui.output_plot("residuals_histogram", height="500px")),
        ui.nav_panel("Model Results", ui.output_text_verbatim("model_summary")),
        ui.nav_panel("Data Summary", ui.output_data_frame("data_summary")),
    ),
    title="Mixed Effects Analysis - Residuals by Study",
)


# ---------------------------------------------------------------------------
# Server
# ---------------------------------------------------------------------------
def server(input, output, session):
    study_data = reactive.value(None)
    mixed_results = reactive.value(None)
    fixed_effects = reactive.value(None)
    variance_components = reactive.value(None)

    @reactive.effect
    @reactive.event(input.run_analysis)
    def _run_analysis():
        with ui.Progress(min=0, max=1) as p:
            p.set(0.2, message="Running analysis...", detail="Generating data...")
            data = generate_study_data(int(input.study_id()))
            study_data.set(data)

            p.set(0.4, detail="Uploading data to SAS...")
            SAS.df2sd(data, "study_data")

            p.set(0.6, detail="Running mixed effects model...")
            SAS.submit(SAS_CODE)

            p.set(0.8, detail="Retrieving results...")
            fixed_effects.set(SAS.sd2df("fixed_effects"))
            mixed_results.set(SAS.sd2df("mixed_results"))
            variance_components.set(SAS.sd2df("variance_components"))

            p.set(1.0, detail="Complete!")

    @render.plot
    def residuals_histogram():
        res = mixed_results.get()
        if res is None:
            return None

        resid = res["Resid"].dropna()
        binwidth = (resid.max() - resid.min()) / 30 if len(resid) else None

        return (
            ggplot(res, aes(x="Resid"))
            + geom_histogram(
                binwidth=binwidth,
                fill="lightblue",
                color="black",
                alpha=0.7,
            )
            + labs(
                title=f"Histogram of Residuals - Study {input.study_id()}",
                x="Residuals",
                y="Count",
            )
            + theme_minimal()
            + theme(
                plot_title=element_text(size=16, weight="bold"),
                axis_title=element_text(size=12),
                axis_text=element_text(size=10),
            )
        )

    @render.text
    def model_summary():
        fx = fixed_effects.get()
        vc = variance_components.get()
        if fx is None or vc is None:
            return ""

        parts = [
            "Fixed Effects:",
            "==============",
            fx.to_string(index=False),
            "",
            "",
            "Variance Components:",
            "===================",
            vc.to_string(index=False),
        ]

        res = mixed_results.get()
        if res is not None:
            parts += [
                "",
                "",
                "Residuals Summary:",
                "=================",
                res["Resid"].describe().to_string(),
            ]
        return "\n".join(parts)

    @render.data_frame
    def data_summary():
        data = study_data.get()
        if data is None:
            return pd.DataFrame()

        summary = (
            data.groupby(["treatment_group", "visit"], as_index=False)
            .agg(
                n=("outcome", "size"),
                mean_outcome=("outcome", "mean"),
                sd_outcome=("outcome", "std"),
                median_outcome=("outcome", "median"),
            )
            .round({"mean_outcome": 2, "sd_outcome": 2, "median_outcome": 2})
        )
        return summary


app = App(app_ui, server)
