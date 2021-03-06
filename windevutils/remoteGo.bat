: Run local jovo against remote dynamodb

: I'm not always seeing jovo3 update correctly when
: I run tsc and jovo3 in watch mode, so I kick off
: the build-and-run manually.

: Set params. If you want to use default, safest is to explicitly
: set them empty. Yes, we should scope these local.
: DO NOT QUOTE THESE VALUES, at least not now -- Windows will
: include the quotes in the string, and my code will not strip
: them out again.
set DYNAMODB_REGION=us-east-1
set DYNAMODB_ENDPOINT=https://dynamodb.%DYNAMODB_REGION%.amazonaws.com
set NSOD_EPISODES_TABLE=episodes_debug
set NSOD_PROGRAM=newsounds

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.
: Local stage means we will run the jovo code locally, even though
: we are using the hosted database. To put everything out on AWS, see
: productionGo.bat

cls
call tsc
call jovo3 build --stage local
call jovo3 deploy --target local
call jovo3 run

