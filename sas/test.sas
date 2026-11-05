/* Analysis of the synthetic study dataset.
   Run create_data.sas first - it writes large_study_data.sas7bdat.
   Set rootdir to the root of this repository (default: the SAS working
   directory, i.e. run SAS from the repository root). */
%let rootdir = .;
libname demo "&rootdir";

/* Simple PROC MIXED analysis with residuals output */
proc hpmixed data=demo.large_study_data;
    class unique_subject_id study_id treatment_group visit;
    model outcome=visit treatment_group visit*treatment_group / solution;
    random intercept / subject=unique_subject_id;
    random intercept / subject=study_id;
    random visit / subject=unique_subject_id type=ar(1);
    output out=mixed_results predicted=Pred residual=Resid;
    ods output ParameterEstimates=fixed_effects CovParms=variance_components;
    performance threadlevelize;
run;

/* Check residuals and model diagnostics */
proc univariate data=mixed_results plots;
    var resid;
    histogram;
    qqplot;
    title 'Residual Analysis for Mixed Model';
run;

/* Create diagnostic plots */
proc sgplot data=mixed_results;
    scatter x=pred y=resid;
    refline 0 / axis=y;
    title 'Residuals vs Predicted Values';
run;
