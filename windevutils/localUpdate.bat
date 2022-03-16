cls
set DYNAMODB_REGION=
set DYNAMODB_ENDPOINT=
set NSOD_EPISODES_TABLE=
set NSOD_PROGRAM=

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.
call tsc
node dist\src\episodesdb_update.js
