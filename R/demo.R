library(sasquatch)
library(tidyverse)

# Read the dataset created by sas/create_data.sas
# (path is relative to the R/ folder)
large_study_data <- haven::read_sas("../sas/large_study_data.sas7bdat")

# Check the dataset size (equivalent to PROC SQL)
large_study_data |>
  summarise(
    total_observations = n(),
    num_studies = n_distinct(study_id),
    num_sites = n_distinct(site_id),
    num_subjects = n_distinct(unique_subject_id)
  )

# Create a SAS session
sasquatch::sas_connect(cfgname = "ssh", reconnect = TRUE)

# Copy R dataframe into SAS session context
sas_from_r(large_study_data, "large_study_data")

# Our SAS code lives in an R string
my_code <- "
/* Simple PROC MIXED analysis with residuals output */
proc hpmixed data=large_study_data method=reml;
    performance threadlevelize; 
    class unique_subject_id study_id treatment_group visit;
    model outcome=visit treatment_group visit*treatment_group / solution;
    random intercept / subject=unique_subject_id;
    random intercept / subject=study_id;
    random visit / subject=unique_subject_id type=ar(1);
    output out=mixed_results predicted=Pred residual=Resid;
    ods output ParameterEstimates=fixed_effects CovParms=variance_components;
run;
"

# Submit code to SAS
result <- sas_run_string(my_code, capture = "both")

cat(result$x$log)

# Get the fixed effects results as R dataframe
fixed_effects_df <- sas_to_r("fixed_effects")


# Get the mixed results as R dataframe
mixed_results_df <- sas_to_r("mixed_results")


# Get the variance components results as R dataframe
variance_components_df <- sas_to_r("variance_components")

# disconnect
sas_disconnect()


# Summary statistics by treatment and visit
large_study_data |>
  group_by(treatment_group, visit) |>
  summarise(
    n = n(),
    mean_outcome = mean(outcome, na.rm = TRUE),
    sd_outcome = sd(outcome, na.rm = TRUE),
    median_outcome = median(outcome, na.rm = TRUE),
    q1_outcome = quantile(outcome, 0.25, na.rm = TRUE),
    q3_outcome = quantile(outcome, 0.75, na.rm = TRUE),
    min_outcome = min(outcome, na.rm = TRUE),
    max_outcome = max(outcome, na.rm = TRUE),

    mean_age = mean(age, na.rm = TRUE),
    sd_age = sd(age, na.rm = TRUE),
    median_age = median(age, na.rm = TRUE),
    q1_age = quantile(age, 0.25, na.rm = TRUE),
    q3_age = quantile(age, 0.75, na.rm = TRUE),
    min_age = min(age, na.rm = TRUE),
    max_age = max(age, na.rm = TRUE)
  ) |>
  print(n = Inf) # Show all rows

# Histogram of residuals
library(ggplot2)

# Histogram
ggplot(mixed_results_df, aes(x = Resid)) +
  geom_histogram(
    binwidth = function(x) diff(range(x)) / 30,
    fill = "lightblue",
    color = "black"
  ) +
  labs(title = "Histogram of Residuals", x = "Residuals", y = "Count")

# Q-Q plot
ggplot(mixed_results_df, aes(sample = Resid)) +
  stat_qq() +

  stat_qq_line() +
  labs(title = "Normal Q-Q Plot of Residuals")

# Create diagnostic plots (equivalent to PROC SGPLOT)
# Scatter plot of residuals vs predicted values
ggplot(mixed_results_df, aes(x = Pred, y = Resid)) +
  geom_point(alpha = 0.6) +
  geom_hline(yintercept = 0, color = "red", linetype = "dashed") +
  labs(
    title = "Residuals vs Predicted Values",
    x = "Predicted Values",
    y = "Residuals"
  ) +
  theme_minimal()
