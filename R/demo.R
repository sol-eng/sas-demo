library(sasquatch)
library(tidyverse)

# Set random seed for reproducibility
set.seed(12345)

# Generate manageable synthetic dataset for mixed effects modeling
large_study_data <- expand_grid(
  study_id = 1:5,
  site_id = 1:2,
  subject_id = 1:20,
  visit = 1:4
) |>
  mutate(
    # Create unique subject identifier across all studies/sites
    unique_subject_id = (study_id * 100) + (site_id * 20) + subject_id,

    # Generate subject-level random effects (same for each subject across visits)
    subject_intercept = rep(
      rnorm(n_distinct(unique_subject_id), mean = 0, sd = 2),
      each = 4
    )[row_number()],

    # Time-varying covariates
    age = runif(n(), min = 18, max = 75),
    gender = rbinom(n(), size = 1, prob = 0.52), # 52% female
    treatment = rbinom(n(), size = 1, prob = 0.5), # 50% treatment
    baseline_score = rnorm(n(), mean = 50, sd = 10),

    # Study and site effects
    study_effect = rnorm(n(), mean = 0, sd = 1.5),
    site_effect = rnorm(n(), mean = 0, sd = 1.0),

    # Generate outcome with complex mixed effects structure
    time_trend = visit * 2.5,
    treatment_effect = treatment * 8.3,
    age_effect = (age - 45) * 0.2,
    gender_effect = gender * 3.1,

    # Random error
    error = rnorm(n(), mean = 0, sd = 3.2),

    # Final outcome
    outcome = 45 +
      time_trend +
      treatment_effect +
      age_effect +
      gender_effect +
      study_effect +
      site_effect +
      subject_intercept +
      error
  ) |>
  # Add some missing data patterns
  mutate(
    outcome = if_else(runif(n()) < 0.05, NA_real_, outcome),
    age = if_else(runif(n()) < 0.02, NA_real_, age)
  ) |>
  # Create categorical versions
  mutate(
    age_group = case_when(
      is.na(age) ~ "Unknown",
      age < 30 ~ "Young",
      age < 50 ~ "Middle",
      age >= 50 ~ "Older"
    ),
    treatment_group = if_else(treatment == 1, "Active", "Placebo"),
    gender_label = if_else(gender == 1, "Female", "Male")
  )

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
