: I'm not always seeing jovo3 update correctly when
: I run tsc and jovo3 in watch mode, so I kick off
: the build-and-run manually.

: Use defaults (reset in case we tried a remote run earlier)
set DYNAMODB_REGION=
set DYNAMODB_ENDPOINT=
set NSOD_EPISODES_TABLE=
set NSOD_PROGRAM=

cls

: Call needed to keep batchfiles from not returning and prematurely ending run.
: (Alternative is to chain them with & in a single line.)
call tsc
call jovo3 build
call jovo3 deploy %*
call jovo3 run
