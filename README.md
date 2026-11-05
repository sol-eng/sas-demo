# SAS Demo

This repository contains demonstration code highlighting the possibilities in a polyglot/multilingual data science world, specifically using SAS and R. 

## Project Structure

### `/sas`

Clinical Trial simulation using the SAS language. Can be run within Positron using the SAS extension for VS Code but also the Positron SAS Extension. 

Contains SAS scripts:
- `create_data.sas`: Generates the synthetic study data and saves it as `large_study_data.sas7bdat` to the repository root, plus an extra copy in `/quarto`. **Run this first.** Set `rootdir` at the top of the script to the repository root (default: the SAS working directory).
- `test.sas`: Mixed model analysis and diagnostics on `large_study_data.sas7bdat`

### `/R`

Same as above, but the analysis is driven from R and the visualisation steps are replaced by R language. The data is read from `large_study_data.sas7bdat` in the repository root via `haven::read_sas()`. SAS is called from within R via the `sasquatch` package. 

Contains standalone R scripts:
- `demo.R`: Example R script for data analysis
- `renv.lock`: R environment dependency lock file

### `/quarto`

Same approach than in `/R` (including reading `large_study_data.sas7bdat`), but wrapped everything into quarto code chunks. We no longer need to explicitly call SAS from R, it's all taken care by the quarto extension within the `slcr` package.

Contains Quarto documents for reproducible data analysis and reporting:
- `demo.qmd`: Example Quarto document
- `large_study_data.sas7bdat`: Extra copy of the dataset written by `sas/create_data.sas`; listed under `resource_files` so it is bundled when publishing, e.g. to Posit Connect.
- `renv.lock`: R environment dependency lock file

A sample document can be viewed at [https://pub.current.posit.team/public/quarto-sas/](https://pub.current.posit.team/public/quarto-sas/)

### `/shiny`

Embed the `R` code from above into a R Shiny app for interactive visualisation. The data is generated dynamically in the app and does not use the `sas7bdat` file.

Contains Shiny web application:
- `app.R`: Shiny application code
- `renv.lock`: R environment dependency lock file

## Getting Started

To run the examples in this repository, make sure you have the appropriate software installed:
- R and relevant packages (for R and Shiny examples)
- Quarto (for Quarto documents)
- Access to SAS (e.g. Analytics Pro via ssh)

## Dependencies

Each subfolder containing R code has its own `renv.lock` file to manage dependencies. Use the `renv` package to restore the required package environment.
