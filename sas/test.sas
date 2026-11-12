/* Analysis of the synthetic study dataset (large_study_data.sas7bdat, written by create_data.sas).
Where the data is read from:
- clinical job: _SASWS_ is the job's workspace (PositDemo/SAS-Demo/data/sdtm, synced from the repository);
- SAS Viya session with Clinical Acceleration: the workspace mount /clinical/workspaces (same layout;
  SAS Studio sets _SASWS_ to its WORK folder, hence the PositDemo check);
- anywhere else (SAS Analytics Pro, SAS Studio, Positron): the root of this repository, ~/sas-demo. */
data _null_;
    length ws $ 1024;
    ws = '/clinical/workspaces';
    if symexist('_SASWS_') then
        if fileexist(cats(symget('_SASWS_'), '/PositDemo')) then ws = symget('_SASWS_');
    call symputx('ws', ws);
    call symputx('clinical', fileexist(cats(ws, '/PositDemo/SAS-Demo/data/sdtm')));
run;

%let repo_path="&ws/PositDemo/SAS-Demo/data/sdtm/";
%if not &clinical %then %do; %let repo_path="%sysget(HOME)/sas-demo"; %end;
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

/* Diagnostic plot. With Clinical Acceleration also as a PDF in the outputs folder (the repository
accepts only the file types in allowedFileExtensions: pdf yes, png no; dlcreatedir creates the folder). */
%if &clinical %then %do;
    options dlcreatedir;
    libname outdir "&ws/PositDemo/SAS-Demo/outputs/";
    libname outdir clear;
    ods pdf file="&ws/PositDemo/SAS-Demo/outputs/residuals_vs_predicted.pdf";
%end;

proc sgplot data=mixed_results;
    scatter x=pred y=resid;
    refline 0 / axis=y;
    title 'Residuals vs Predicted Values';
run;

%if &clinical %then %do;
    ods pdf close;
%end;
