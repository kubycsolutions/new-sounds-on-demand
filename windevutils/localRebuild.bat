cls

: TSC is apparently a batchfile, and either needs to be CALLed or single-lined
: to avoid ending the script prematurely.
call tsc
node dist\src\episodesdb_rebuild.js
