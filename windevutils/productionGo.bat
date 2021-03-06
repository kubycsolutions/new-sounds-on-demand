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

cls

: I've found jovo3 doesn't always notice when a file has been changed, and
: may skip things like the grammar builds. Flush the previous build to
: insist on a complete refresh.
rmdir /s bundle

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely. NOTE that
: "jovo3 build" should be running TSC, and in fact running it with a
: slightly different configuration, so this may be redundant.
call tsc

call jovo3 build --stage lambda

call jovo3 deploy

: There's currently a problem (at least on my box) where jovo deploy is not
: reliably producing and uploading the zipfile. This workaround produces it.
call npm run bundle

: For the workaround, we need to upload the jarfile explicitly.
: User (see output of  aws sts get-caller-identity) must have appropriate
: permissions to allow this. For now I'm just doing manual upload

: aws lambda update-function-code --function-name prod-new-sounds-on-demand --zip-file fileb://bundle.zip  --dry-run

: No "jovo3 run", since the lambda now handles execution.
