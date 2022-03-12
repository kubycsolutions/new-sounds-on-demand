@for %%f in ("%path:;=" "%") do @if exist %%f\%1 dir %%f\%1
