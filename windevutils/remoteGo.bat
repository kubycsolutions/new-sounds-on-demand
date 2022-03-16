: Run local jovo against remote dynamodb

: I'm not always seeing jovo3 update correctly when
: I run tsc and jovo3 in watch mode, so I kick off
: the build-and-run manually.

// Set params. If you want to use default, safest is to explicitly
// set them empty. Yes, we should scope these local.
set DYNAMODB_REGION=us-east-1
set DYNAMODB_ENDPOINT=https://dynamodb.%DYNAMODB_REGION%.amazonaws.com
set NSOD_EPISODES_TABLE=episodes_debug
set NSOD_PROGRAM="newsounds"

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.

cls & tsc & jovo3 build & jovo3 deploy %* & jovo3 run
