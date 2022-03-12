: To switch from local to lambda, set the stage when deploying
:
: Shouldn't be necessary to explicitly tsc, but
: I'm not always seeing jovo3 update correctly when
: I run tsc and jovo3 in watch mode.
cls & tsc & jovo3 build & jovo3 deploy %* & jovo3 run
