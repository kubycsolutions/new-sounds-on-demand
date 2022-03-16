: I'm not always seeing jovo3 update correctly when
: I run tsc and jovo3 in watch mode, so I kick off
: the build-and-run manually.

: Use defaults (reset in case we tried a remote run earlier)
set DYNAMODB_REGION=
set DYNAMODB_ENDPOINT=
set NSOD_EPISODES_TABLE=
set NSOD_PROGRAM=

cls

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.
call tsc

jovo3 build
jovo3 deploy %*
jovo3 run
