# SAS Demo

This repository contains demonstration code highlighting the possibilities in a polyglot/multilingual data science world, specifically using SAS and R. 

## Project Structure

### `/sas`

Clinical Trial simulation using the SAS language. Can be run within Positron using the Altair SLC extension for VS Code. 

Contains SAS scripts:
- `test.sas`: Example SAS script

### `/R`

Same as above, but data generation and visualisation steps replaced by R language. SAS is called from within R via the `sasquatch` package. 

Contains standalone R scripts:
- `demo.R`: Example R script for data analysis
- `renv.lock`: R environment dependency lock file

### `/quarto`

Same approach than in `/R`, but wrapped everything into quarto code chunks. We no longer need to explicitly call SAS from R, it's all taken care by the quarto extension within the `slcr` package.

Contains Quarto documents for reproducible data analysis and reporting:
- `demo.qmd`: Example Quarto document
- `renv.lock`: R environment dependency lock file

A sample document can be viewed at [https://pub.current.posit.team/public/quarto-sas/](https://pub.current.posit.team/public/quarto-sas/)

### `/shiny`

Embed the `R` code from above into a R Shiny app for interactive visualisation. 

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
