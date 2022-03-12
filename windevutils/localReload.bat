: For some reason, Windows 10 currently seems happier about the compile-and-run
: sequence if tsc and node are in a single command line. Rather than argue
: with it...
cls
tsc & node dist\src\new\episodesdb_reload.js
