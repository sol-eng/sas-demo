library(shiny)
library(tidyverse)
library(ggplot2)
library(sasquatch)

library(reticulate)

#virtualenv_create("r-saspy", requirements = "requirements.txt")
#use_virtualenv("r-saspy", required = TRUE)

get_fresh_token <- function() {
  product <- Sys.getenv("POSIT_PRODUCT")

  if (product == "WORKBENCH") {
    audience <- Sys.getenv("WORKBENCH_VIYA_RESOURCE")
    if (!nzchar(audience)) {
      stop("WORKBENCH_VIYA_RESOURCE environment variable is not set.", call. = FALSE)
    }
    workbench <- import("posit.workbench")
    client <- workbench$Client()
    token <- client$oauth$get_credentials(audience = audience)$access_token

  } else if (product == "CONNECT") {
    # connect_viewer_token() picks up the visitor's Shiny session from the
    # parent environment, plus CONNECT_SERVER / CONNECT_API_KEY automatically.
    res <- Sys.getenv("CONNECT_VIYA_RESOURCE")
    resource <- if (nzchar(res)) res else NULL

    message("[get_fresh_token] CONNECT branch")
    message("[get_fresh_token] CONNECT_SERVER = ", Sys.getenv("CONNECT_SERVER"))
    message("[get_fresh_token] CONNECT_VIYA_RESOURCE = ",
            if (is.null(resource)) "<unset/NULL>" else resource)

    # --- Gate diagnostics: pinpoint why has_viewer_token() returns FALSE ---
    message("[diag] POSIT_PRODUCT   = ", Sys.getenv("POSIT_PRODUCT"))
    message("[diag] RSTUDIO_PRODUCT = ", Sys.getenv("RSTUDIO_PRODUCT"))
    message("[diag] running_on_connect = ",
            tryCatch(connectcreds:::running_on_connect(),
                     error = function(e) paste("error:", conditionMessage(e))))
    message("[diag] shiny namespace loaded = ", isNamespaceLoaded("shiny"))
    message("[diag] reactive domain is NULL = ",
            tryCatch(is.null(shiny::getDefaultReactiveDomain()),
                     error = function(e) paste("error:", conditionMessage(e))))
    message("[diag] get_connect_session() is NULL = ",
            tryCatch(is.null(connectcreds:::get_connect_session()),
                     error = function(e) paste("error:", conditionMessage(e))))
    message("[diag] CONNECT_API_KEY set = ", nzchar(Sys.getenv("CONNECT_API_KEY")))

    # has_viewer_token() swallows the real error via try_fetch + debug_inform.
    # Call connect_viewer_token() directly to surface WHY the exchange fails.
    direct <- tryCatch(
      {
        tok <- connectcreds::connect_viewer_token(resource = resource)$access_token
        paste0("OK (nchar=", nchar(tok), ")")
      },
      error = function(e) {
        # Walk the full condition chain to capture nested causes
        msgs <- character(0)
        cnd <- e
        while (!is.null(cnd)) {
          msgs <- c(msgs, conditionMessage(cnd))
          cnd <- cnd$parent
        }
        paste0("ERROR chain:\n  - ", paste(msgs, collapse = "\n  - "))
      }
    )
    message("[diag] connect_viewer_token() direct = ", direct)

    # --- Raw request to the EXACT endpoint connectcreds uses ---------------
    # Replicates connect_oauth_client(): {CONNECT_SERVER stripped of one
    # trailing slash}/__api__/v1/oauth/integrations/credentials, with the
    # visitor session token + API key. Captures the raw text/plain body.
    raw_diag <- tryCatch(
      {
        sess <- connectcreds:::get_connect_session()
        session_token <- sess$request$HTTP_POSIT_CONNECT_USER_SESSION_TOKEN
        server_url <- sub("/$", "", Sys.getenv("CONNECT_SERVER"))
        token_url <- paste0(server_url,
                            "/__api__/v1/oauth/integrations/credentials")

        resp <- httr2::request(token_url) |>
          httr2::req_method("POST") |>
          httr2::req_headers(
            Authorization = paste("Key", Sys.getenv("CONNECT_API_KEY"))
          ) |>
          httr2::req_body_form(
            grant_type         = "urn:ietf:params:oauth:grant-type:token-exchange",
            subject_token_type = "urn:posit:connect:user-session-token",
            subject_token      = session_token
          ) |>
          httr2::req_error(is_error = function(resp) FALSE) |>
          httr2::req_perform()

        # Read status/content-type/length FIRST; guard the body read so an
        # empty body doesn't abort before we log the useful metadata.
        status  <- httr2::resp_status(resp)
        ctype   <- tryCatch(httr2::resp_content_type(resp),
                            error = function(e) "<none>")
        clen    <- tryCatch(httr2::resp_header(resp, "content-length"),
                            error = function(e) "<none>")
        body    <- tryCatch(
          {
            b <- httr2::resp_body_string(resp)
            if (!nzchar(b)) "<empty>" else substr(b, 1, 1000)
          },
          error = function(e) paste0("<no body: ", conditionMessage(e), ">")
        )
        all_hdrs <- tryCatch(
          paste(names(httr2::resp_headers(resp)), collapse = ", "),
          error = function(e) "<none>"
        )

        paste0(
          "\n  token_url      = ", token_url,
          "\n  session_token? = ", !is.null(session_token),
          "\n  status         = ", status,
          "\n  status_desc    = ", httr2::resp_status_desc(resp),
          "\n  content-type   = ", ctype,
          "\n  content-length = ", clen,
          "\n  headers        = ", all_hdrs,
          "\n  body           = ", body
        )
      },
      error = function(e) paste0("\n  (raw request failed: ", conditionMessage(e), ")")
    )
    message("[diag] raw token endpoint =", raw_diag)
    # ----------------------------------------------------------------------

    message("[get_fresh_token] has_viewer_token (resource) = ",
            tryCatch(
              connectcreds::has_viewer_token(resource = resource),
              error = function(e) paste("error:", conditionMessage(e))
            ))
    message("[get_fresh_token] has_viewer_token (NULL) = ",
            tryCatch(
              connectcreds::has_viewer_token(),
              error = function(e) paste("error:", conditionMessage(e))
            ))

    token <- tryCatch(
      connectcreds::connect_viewer_token(resource = resource)$access_token,
      error = function(e) {
        # The exchange failed (often a text/plain error body from Connect).
        # Try to fetch the raw response from Connect's token endpoint so we
        # can see exactly what was returned.
        raw_info <- tryCatch(
          {
            server <- sub("/+$", "", Sys.getenv("CONNECT_SERVER"))
            token_url <- paste0(server, "/__api__/v1/oauth/integrations/credentials")
            resp <- httr2::request(token_url) |>
              httr2::req_headers(
                Authorization = paste("Key", Sys.getenv("CONNECT_API_KEY"))
              ) |>
              httr2::req_error(is_error = function(resp) FALSE) |>
              httr2::req_perform()
            paste0(
              "\n--- raw token endpoint response ---",
              "\nURL: ", token_url,
              "\nstatus: ", httr2::resp_status(resp),
              "\ncontent-type: ", httr2::resp_content_type(resp),
              "\nbody:\n", httr2::resp_body_string(resp)
            )
          },
          error = function(e2) paste0("\n(could not fetch raw response: ",
                                      conditionMessage(e2), ")")
        )

        stop(
          "connect_viewer_token() failed: ", conditionMessage(e),
          raw_info,
          call. = FALSE
        )
      }
    )

  } else {
    stop("Unsupported POSIT_PRODUCT: '", product, "'.", call. = FALSE)
  }

  if (is.null(token) || !nzchar(token)) {
    stop("OAuth returned an empty access token.", call. = FALSE)
  }

  token
}

connect_viya <- function() {
  saspy<-import("saspy")
  saspy$SASsession(
    cfgname = "viya",
    authtoken = get_fresh_token()
  )
}

init_sas <- function() {
  sess <- connect_viya()
  assign("session", sess, envir = sasquatch:::.pkgenv)
  invisible(sess)
}

# App-level flag so the SAS/Viya connection is established only once,
# even across multiple user sessions.
.sas_ready <- FALSE

# Ensure the SAS/Viya session is closed when the app shuts down.
onStop(function() {
  sasquatch::sas_disconnect()
})

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
  # Establish the SAS/Viya connection once, showing a splash while it runs.
  if (!.sas_ready) {
    showModal(modalDialog(
      title = "Connecting to SAS Viya",
      tagList(
        tags$div(
          style = "text-align:center;",
          tags$div(class = "spinner-border text-primary", role = "status"),
          tags$p("Establishing SAS Viya session, please wait...")
        )
      ),
      footer = NULL,
      easyClose = FALSE
    ))

    # Run the blocking connect only after the modal has rendered.
    session$onFlushed(function() {
      tryCatch(
        {
          init_sas()
          .sas_ready <<- TRUE
          removeModal()
        },
        error = function(e) {
          showModal(modalDialog(
            title = "SAS Viya Connection Failed",
            tagList(
              tags$p("Could not establish a SAS Viya session."),
              tags$pre(conditionMessage(e)),
              tags$p("Verify that SAS Viya is available and reload the app to retry.")
            ),
            footer = modalButton("Dismiss"),
            easyClose = TRUE
          ))
        }
      )
    }, once = TRUE)
  }

  # Reactive values to store results
  values <- reactiveValues(
    mixed_results = NULL,
    fixed_effects = NULL,
    variance_components = NULL,
    study_data = NULL
  )

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
