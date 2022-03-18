cls

: DO NOT QUOTE ENVIRONMENT VALUES UNLESS YOU WANT THE QUOTES TO BE
: PART OF THE VALUE. In particular, don't do it inconsistently.
set DYNAMODB_REGION=us-east-1
set DYNAMODB_ENDPOINT=https://dynamodb.%DYNAMODB_REGION%.amazonaws.com
set NSOD_EPISODES_TABLE=nsod_production_episodes
set NSOD_PROGRAM=newsounds

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.
tsc && node dist\src\episodesdb_reload.js
