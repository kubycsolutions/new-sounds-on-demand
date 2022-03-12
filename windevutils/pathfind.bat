: Lazy man's equivalent of the Unix "which" command -- search the path
: for the named file. Wildcards are supported, and may be needed if you
: aren't sure whether the file is .bat, .exe, or something else.
: Not New Sounds related, so I'll probably take it out of the package eventually.
@for %%f in ("%path:;=" "%") do @if exist %%f\%1 @dir /b /s %%f\%1
