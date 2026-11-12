/* Analysis of the synthetic study dataset from the clinical repository
(/PositDemo/SAS-Demo/data/sdtm/large_study_data.sas7bdat).
Workspace root: in a clinical job _SASWS_ points to the job's workspace. Interactively
(SAS Viya session, SAS Studio) the workspace is mounted at /clinical/workspaces and mirrors
the repository path; SAS Studio sets _SASWS_ to its WORK folder, hence the PositDemo check. */
data _null_;
    ws = '/clinical/workspaces';
    if symexist('_SASWS_') then
        if fileexist(cats(symget('_SASWS_'), '/PositDemo')) then ws = symget('_SASWS_');
    call symputx('ws', ws);
run;

%let repo_path="&ws/PositDemo/SAS-Demo/data/sdtm/";
libname demo &repo_path;

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

/* Diagnostic plot as a PDF in the outputs folder (the repository accepts only the file types
in allowedFileExtensions: pdf yes, png no). dlcreatedir creates the folder if it is missing. */
%let out_path="&ws/PositDemo/SAS-Demo/outputs/";
options dlcreatedir;
libname outdir &out_path;
libname outdir clear;

ods pdf file="&ws/PositDemo/SAS-Demo/outputs/residuals_vs_predicted.pdf";

proc sgplot data=mixed_results;
    scatter x=pred y=resid;
    refline 0 / axis=y;
    title 'Residuals vs Predicted Values';
run;
ods pdf close;
