library(shiny)
library(tidyverse)
library(ggplot2)
library(sasquatch)

# UI
ui <- fluidPage(
  titlePanel("Mixed Effects Analysis - Residuals by Study"),

  sidebarLayout(
    sidebarPanel(
      selectInput(
        "study_id",
        "Select number of studies:",
        choices = c(1, 2, 5, 10, 20, 50),
        selected = 1
      ),

      actionButton("run_analysis", "Run Analysis", class = "btn-primary"),

      br(),
      br(),

      helpText(
        "Select a study ID and click 'Run Analysis' to generate data, 
               run the mixed effects model in SAS, and display the residuals histogram."
      )
    ),

    mainPanel(
      tabsetPanel(
        tabPanel(
          "Histogram",
          plotOutput("residuals_histogram", height = "500px")
        ),
        tabPanel("Model Results", verbatimTextOutput("model_summary")),
        tabPanel("Data Summary", tableOutput("data_summary"))
      )
    )
  )
)

# Server
server <- function(input, output, session) {
  # Reactive values to store results
  values <- reactiveValues(
    mixed_results = NULL,
    fixed_effects = NULL,
    variance_components = NULL,
    study_data = NULL
  )

  # Initialize SAS connection
  sas_setup <- reactive({
    req(input$run_analysis)

    withProgress(message = "Initializing SAS...", value = 0.1, {
      sasquatch::sas_connect(cfgname = "ssh", reconnect = TRUE)
    })
  })

  # Generate and analyze data when button is clicked
  observeEvent(input$run_analysis, {
    withProgress(message = "Running analysis...", {
      incProgress(0.2, detail = "Generating data...")

      # Set random seed for reproducibility
      set.seed(12345)

      # Generate data for selected study
      study_data <- expand_grid(
        study_id = 1:as.numeric(input$study_id),
        site_id = 1:2,
        subject_id = 1:20,
        visit = 1:4
      ) |>
        mutate(
          unique_subject_id = (study_id * 100) + (site_id * 20) + subject_id,
          subject_intercept = rep(
            rnorm(n_distinct(unique_subject_id), mean = 0, sd = 2),
            each = 4
          )[row_number()],
          age = runif(n(), min = 18, max = 75),
          gender = rbinom(n(), size = 1, prob = 0.52),
          treatment = rbinom(n(), size = 1, prob = 0.5),
          baseline_score = rnorm(n(), mean = 50, sd = 10),
          study_effect = rnorm(n(), mean = 0, sd = 1.5),
          site_effect = rnorm(n(), mean = 0, sd = 1.0),
          time_trend = visit * 2.5,
          treatment_effect = treatment * 8.3,
          age_effect = (age - 45) * 0.2,
          gender_effect = gender * 3.1,
          error = rnorm(n(), mean = 0, sd = 3.2),
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
        mutate(
          outcome = if_else(runif(n()) < 0.05, NA_real_, outcome),
          age = if_else(runif(n()) < 0.02, NA_real_, age)
        ) |>
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

      values$study_data <- study_data

      incProgress(0.3, detail = "Setting up SAS connection...")

      # Get SAS setup
      sasquatch::sas_connect(cfgname = "ssh", reconnect = TRUE)

      incProgress(0.4, detail = "Uploading data to SAS...")

      # Upload data to SAS
      sas_from_r(study_data, "study_data")

      cat("running")
      incProgress(0.6, detail = "Running mixed effects model...")

      # Define and run SAS code
      my_code <- "
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
      "

      result <- sas_run_string(my_code, capture = "both")

      incProgress(0.8, detail = "Retrieving results...")

      # Get results
      # Get the fixed effects results as R dataframe
      values$fixed_effects <- sas_to_r("fixed_effects")

      # Get the mixed results as R dataframe
      values$mixed_results <- sas_to_r("mixed_results")

      # Get the variance components results as R dataframe
      values$variance_components <- sas_to_r("variance_components")

      # disconnect
      sas_disconnect()

      incProgress(1.0, detail = "Complete!")
    })
  })

  # Histogram output
  output$residuals_histogram <- renderPlot({
    req(values$mixed_results)

    ggplot(values$mixed_results, aes(x = Resid)) +
      geom_histogram(
        binwidth = function(x) diff(range(x, na.rm = TRUE)) / 30,
        fill = "lightblue",
        color = "black",
        alpha = 0.7
      ) +
      labs(
        title = paste("Histogram of Residuals - Study", input$study_id),
        x = "Residuals",
        y = "Count"
      ) +
      theme_minimal() +
      theme(
        plot.title = element_text(size = 16, face = "bold"),
        axis.title = element_text(size = 12),
        axis.text = element_text(size = 10)
      )
  })

  # Model summary output
  output$model_summary <- renderPrint({
    req(values$fixed_effects, values$variance_components)

    cat("Fixed Effects:\n")
    cat("==============\n")
    print(values$fixed_effects)

    cat("\n\nVariance Components:\n")
    cat("===================\n")
    print(values$variance_components)

    cat("\n\nResiduals Summary:\n")
    cat("=================\n")
    if (!is.null(values$mixed_results)) {
      print(summary(values$mixed_results$Resid))
    }
  })

  # Data summary output
  output$data_summary <- renderTable({
    req(values$study_data)

    values$study_data |>
      group_by(treatment_group, visit) |>
      summarise(
        n = n(),
        mean_outcome = round(mean(outcome, na.rm = TRUE), 2),
        sd_outcome = round(sd(outcome, na.rm = TRUE), 2),
        median_outcome = round(median(outcome, na.rm = TRUE), 2),
        .groups = "drop"
      )
  })
}

# Run the application
shinyApp(ui = ui, server = server)
